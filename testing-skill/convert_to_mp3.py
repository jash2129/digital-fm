import os
import subprocess
import shutil
import imageio_ffmpeg

ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
print(f"Using ffmpeg: {ffmpeg_exe}")

base_dir = os.path.dirname(os.path.abspath(__file__))
repo_root = os.path.abspath(os.path.join(base_dir, ".."))

recordings = [
    {
        "id": "bb5abdd4-5d9e-46c2-8f2f-94e641231c7a",
        "title": "Call_1_Cooperative_Buyer_Full_Success_bb5abdd4",
        "persona": "Cooperative Buyer (Alex Smith) - Full Close & Verification",
        "src": os.path.join(repo_root, "tavus-avatar", "logs-heygen", "bb5abdd4-5d9e-46c2-8f2f-94e641231c7a.webm")
    },
    {
        "id": "2f9cebed-af3e-4d7f-8083-b2f210aa3a4c",
        "title": "Call_2_Rude_Adversarial_Buyer_Negotiation_2f9cebed",
        "persona": "Rude Adversarial Buyer (Marcus Vance) - Hostile & Concession Ladder",
        "src": os.path.join(repo_root, "tavus-avatar", "logs-heygen", "2f9cebed-af3e-4d7f-8083-b2f210aa3a4c.webm")
    },
    {
        "id": "44fb0bea-e8d8-4ba0-b66c-691670ab8d2d",
        "title": "Call_3_Cooperative_Buyer_Baseline_44fb0bea",
        "persona": "Cooperative Buyer (Baseline Run)",
        "src": os.path.join(repo_root, "tavus-avatar", "logs-heygen", "44fb0bea-e8d8-4ba0-b66c-691670ab8d2d.webm")
    }
]

out_dirs = [
    os.path.join(repo_root, "testing-skill", "reports", "mp3_recordings"),
    os.path.join(repo_root, "tavus-avatar", "public", "logs-heygen", "mp3")
]

for d in out_dirs:
    os.makedirs(d, exist_ok=True)

results = []
for rec in recordings:
    src_file = rec["src"]
    if not os.path.exists(src_file):
        print(f"File not found: {src_file}")
        continue

    for d in out_dirs:
        out_named = os.path.join(d, f"{rec['title']}.mp3")
        out_id = os.path.join(d, f"{rec['id']}.mp3")

        cmd = [
            ffmpeg_exe,
            "-y",
            "-i", src_file,
            "-vn",
            "-ar", "44100",
            "-ac", "2",
            "-b:a", "192k",
            out_named
        ]
        print(f"Converting {os.path.basename(src_file)} -> {os.path.basename(out_named)}...")
        subprocess.run(cmd, check=True)
        shutil.copyfile(out_named, out_id)
        
        file_size_mb = round(os.path.getsize(out_named) / (1024 * 1024), 2)
        print(f"Generated: {out_named} ({file_size_mb} MB)")
        results.append({
            "title": rec["title"],
            "persona": rec["persona"],
            "file": out_named,
            "size_mb": file_size_mb,
            "url": f"http://localhost:3000/logs-heygen/mp3/{rec['title']}.mp3"
        })

print("\nAll 3 recordings converted successfully to MP3!")
