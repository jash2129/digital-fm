#!/usr/bin/env python3
"""
Root wrapper for scripts/calculate-latency.py
Delegates to tavus-avatar/scripts/calculate-latency.py
"""
import os
import sys

target = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "tavus-avatar", "scripts", "calculate-latency.py"))
if os.path.isfile(target):
    with open(target, "r", encoding="utf-8") as f:
        code = f.read()
    exec(code, {"__name__": "__main__", "__file__": target, "sys": sys, "os": os})
else:
    print(f"Error: Could not locate {target}")
    sys.exit(1)
