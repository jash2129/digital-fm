import { spawn } from "child_process";

const ngrokPath = "C:\\Users\\rjash\\AppData\\Roaming\\npm\\node_modules\\ngrok\\bin\\ngrok.exe";

console.log("Launching ngrok background daemon...");
const child = spawn(ngrokPath, ["http", "3000", "--host-header=localhost:3000", "--log=stdout"], {
  detached: true,
  stdio: "ignore",
  windowsHide: true,
});

child.unref();

// Poll for tunnel URL
let attempts = 0;
const interval = setInterval(async () => {
  attempts++;
  try {
    const res = await fetch("http://127.0.0.1:4040/api/tunnels");
    if (res.ok) {
      const data = await res.json();
      const tunnels = data.tunnels || [];
      if (tunnels.length > 0) {
        clearInterval(interval);
        console.log("\n==========================================");
        console.log("NGROK TUNNEL ONLINE!");
        tunnels.forEach((t) => {
          console.log(`URL: ${t.public_url} -> ${t.config.addr}`);
        });
        console.log("==========================================\n");
        process.exit(0);
      }
    }
  } catch (e) {
    // wait for server
  }

  if (attempts >= 15) {
    clearInterval(interval);
    console.error("Timed out waiting for ngrok API.");
    process.exit(1);
  }
}, 800);
