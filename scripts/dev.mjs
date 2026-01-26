import { spawn } from "child_process";
import path from "path";
import http from "http";

const root = process.cwd();
const backendDir = path.join(root, "backend");
const frontendDir = path.join(root, "frontend");

const FAST = process.argv.includes("--fast");

function run(cmd, args, cwd) {
    const p = spawn(cmd, args, { cwd, shell: true, stdio: "inherit" });
    p.on("close", (code) => {
        if (code !== 0) process.exit(code);
    });
    return p;
}

function waitForHealth(url, retries = 40, delayMs = 350) {
    return new Promise((resolve, reject) => {
        let attempt = 0;

        const tick = () => {
            attempt++;
            http
                .get(url, (res) => {
                    if (res.statusCode === 200) return resolve();
                    setTimeout(tick, delayMs);
                })
                .on("error", () => {
                    if (attempt >= retries) return reject(new Error("Backend not ready"));
                    setTimeout(tick, delayMs);
                });
        };

        tick();
    });
}

console.log("\n✅ Starting Full Stack Dev...\n");

// 1) Backend setup
console.log("⚙️ Backend setup: init DB");
run("python", ["-m", "app.init_db"], backendDir);

// 2) Refresh data (only in normal mode)
if (!FAST) {
    console.log("📥 Refreshing watchlist data...");
    run("python", ["-m", "app.refresh_watchlist"], backendDir);
} else {
    console.log("⚡ FAST mode: skipping refresh step");
}

// 3) Start backend
console.log("🚀 Starting backend (FastAPI)...");
run("python", ["-m", "uvicorn", "app.main:app", "--reload", "--port", "8000"], backendDir);

// 4) Start frontend only after backend ready
(async () => {
    console.log("⏳ Waiting for backend /health...");
    await waitForHealth("http://127.0.0.1:8000/health");
    console.log("✅ Backend ready. Starting frontend...");
    run("npm", ["run", "dev"], frontendDir);
})();
