import os
import time
import gzip
import shutil
from pathlib import Path
from typing import Optional, Tuple
from datetime import datetime

import boto3
from botocore.config import Config


def _env_first(*names: str) -> str:
    for n in names:
        v = os.environ.get(n)
        if v:
            return v
    raise KeyError(f"Missing required env var. Tried: {', '.join(names)}")


def _s3_client():
    endpoint = _env_first("R2_ENDPOINT", "R2_S3_ENDPOINT", "AWS_ENDPOINT_URL")
    access_key = _env_first("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID")
    secret_key = _env_first("R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY")
    region = os.environ.get("AWS_DEFAULT_REGION", "auto")

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name=region,
    )


def _read_text(path: Path) -> Optional[str]:
    try:
        return path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return None


def _write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


def _atomic_replace_with_retry(src: Path, dest: Path, retries: int = 20, delay: float = 0.25):
    """
    Windows can temporarily lock files. Retry atomic replace.
    """
    last_err = None
    for _ in range(retries):
        try:
            os.replace(src, dest)
            return
        except PermissionError as e:
            last_err = e
            time.sleep(delay)
    raise last_err


def _acquire_lock(lock_path: Path, timeout_seconds: int = 180) -> None:
    """
    Cross-process lock using exclusive file creation.
    Works on Windows without extra deps.
    """
    start = time.time()
    while True:
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
            return
        except FileExistsError:
            if time.time() - start > timeout_seconds:
                raise TimeoutError(f"Timeout waiting for lock: {lock_path}")
            time.sleep(0.25)


def _release_lock(lock_path: Path) -> None:
    try:
        lock_path.unlink(missing_ok=True)
    except TypeError:
        if lock_path.exists():
            lock_path.unlink()


def _download_to_unique_tmp(client, bucket: str, key: str, dest_dir: Path) -> Path:
    """
    Download object to a unique temp file (avoids replacing a stable .gz filename).
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    tmp_name = f"{Path(key).name}.{os.getpid()}.{int(time.time())}.tmp"
    tmp_path = dest_dir / tmp_name

    with open(tmp_path, "wb") as f:
        client.download_fileobj(bucket, key, f)

    return tmp_path


def _gunzip_to_tmp_db(src_gz: Path, dest_db: Path) -> Path:
    """
    Extract gz to a temp db file next to destination.
    """
    tmp_db = dest_db.with_suffix(dest_db.suffix + ".tmp")
    with gzip.open(src_gz, "rb") as src, open(tmp_db, "wb") as dst:
        shutil.copyfileobj(src, dst)
    return tmp_db


def sync_latest_db_from_r2(
    *,
    bucket: str,
    key_gz: str,
    local_data_dir: str,
    local_db_filename: str,
    delete_gz_after: bool = True,
    use_etag_cache: bool = True,
) -> Tuple[bool, str]:
    """
    Downloads R2 object (gz), extracts to .db, overwrites local .db (atomically),
    and deletes the temp gz.
    Skips download if:
      - ETag matches cached ETag (normal case), OR
      - we already downloaded today (extra guard)
    """
    client = _s3_client()

    data_dir = Path(local_data_dir).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)

    local_db = data_dir / local_db_filename
    etag_cache_file = data_dir / f".{local_db_filename}.etag"

    # NEW: daily guard (avoid downloading again and again on restarts)
    downloaded_on_file = data_dir / f".{local_db_filename}.downloaded_on"
    today = datetime.now().date().isoformat()
    last_downloaded_on = _read_text(downloaded_on_file)

    # lock per-db so reload processes don't race
    lock_file = data_dir / f".{local_db_filename}.lock"
    _acquire_lock(lock_file)

    try:
        head = client.head_object(Bucket=bucket, Key=key_gz)
        remote_etag = head["ETag"].strip('"')

        # 1) Primary skip condition: same ETag as last time
        if use_etag_cache:
            local_etag = _read_text(etag_cache_file)
            if local_etag == remote_etag and local_db.exists():
                return (False, f"Latest already present (ETag match={remote_etag}) → {local_db.name}")

        # 2) Secondary skip condition: already downloaded today (even if restarted)
        #    (useful if you restart many times; assumes only one refresh/day)
        if last_downloaded_on == today and local_db.exists():
            return (False, f"Already downloaded today ({today}); skipping → {local_db.name}")

        # download to UNIQUE temp (do NOT replace stable .gz)
        tmp_gz = _download_to_unique_tmp(client, bucket, key_gz, data_dir)

        # extract to temp db
        tmp_db = _gunzip_to_tmp_db(tmp_gz, local_db)

        # atomic replace db with retry (Windows-friendly)
        _atomic_replace_with_retry(tmp_db, local_db)

        # persist etag + downloaded date
        _write_text(etag_cache_file, remote_etag)
        _write_text(downloaded_on_file, today)

        # cleanup gz temp
        if delete_gz_after:
            try:
                tmp_gz.unlink(missing_ok=True)
            except TypeError:
                if tmp_gz.exists():
                    tmp_gz.unlink()

        return (True, f"Updated to latest (etag={remote_etag}) → {local_db.name}")

    finally:
        _release_lock(lock_file)


def sync_all_latest_dbs(local_data_dir: str = "./backend/data") -> None:
    """
    Pull both IN & US from R2 to your local backend/data folder.
    """
    bucket = os.environ.get("R2_BUCKET", "intrinsic-value-db")

    us_key = os.environ.get("R2_US_DB_GZ_KEY", "snapshots/latest/stockapp-us.db.gz")
    in_key = os.environ.get("R2_IN_DB_GZ_KEY", "snapshots/latest/stockapp-in.db.gz")

    updated_us, msg_us = sync_latest_db_from_r2(
        bucket=bucket,
        key_gz=us_key,
        local_data_dir=local_data_dir,
        local_db_filename="stockapp-us.db",
        delete_gz_after=True,
        use_etag_cache=True,
    )

    updated_in, msg_in = sync_latest_db_from_r2(
        bucket=bucket,
        key_gz=in_key,
        local_data_dir=local_data_dir,
        local_db_filename="stockapp-in.db",
        delete_gz_after=True,
        use_etag_cache=True,
    )

    print("[R2 SYNC]", msg_us)
    print("[R2 SYNC]", msg_in)
