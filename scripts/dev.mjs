import { spawn } from "child_process";
import path from "path";
import http from "http";

const root = process.cwd();
const backendDir = path.join(root, "backend");
const frontendDir = path.join(root, "frontend");

function run(cmd, args, cwd) {
    const p = spawn(cmd, args, { cwd, shell: true, stdio: "inherit" });
    p.on("close", (code) => {
        if (code !== 0) process.exit(code);
    });
    return p;
}

function waitForHealth(url, retries = 900, delayMs = 500) {
    // 900 * 0.5s = 450s = 7.5 minutes (enough for first-time 1GB download+unzip)
    return new Promise((resolve, reject) => {
        let attempt = 0;

        const tick = () => {
            attempt++;

            http
                .get(url, (res) => {
                    if (res.statusCode === 200) return resolve();
                    if (attempt % 20 === 0) {
                        console.log(`⏳ Still waiting for backend... (${attempt}/${retries})`);
                    }
                    setTimeout(tick, delayMs);
                })
                .on("error", () => {
                    if (attempt % 20 === 0) {
                        console.log(`⏳ Still waiting for backend... (${attempt}/${retries})`);
                    }
                    if (attempt >= retries) return reject(new Error("Backend not ready"));
                    setTimeout(tick, delayMs);
                });
        };

        tick();
    });
}


console.log("\n✅ Starting Full Stack Dev (R2 latest auto-sync)...\n");

// 1) Start backend (FastAPI) — it will sync latest DBs from R2 in startup()
console.log("🚀 Starting backend (FastAPI)...");
run("python", ["-m", "uvicorn", "app.main:app", "--reload", "--host", "127.0.0.1", "--port", "8000"], backendDir);

// 2) Start frontend only after backend ready
(async () => {
    console.log("⏳ Waiting for backend /health...");
    await waitForHealth("http://127.0.0.1:8000/health");
    console.log("✅ Backend ready. Starting frontend...");
    run("npm", ["run", "dev"], frontendDir);
})();
