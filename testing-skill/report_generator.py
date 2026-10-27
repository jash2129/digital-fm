"""
Report Generator
Aggregates test run results into:
1. CSV (Google Sheets compatible)
2. Daily Markdown report
3. Full Visual Dashboard with Graphs & Second-by-Second Inspector (summary.html)
"""

import csv
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any

REPORTS_DIR = Path(__file__).parent / "reports"
CSV_PATH = REPORTS_DIR / "test_results.csv"
MARKDOWN_PATH = REPORTS_DIR / "daily_report.md"
HTML_PATH = REPORTS_DIR / "summary.html"
HISTORY_PATH = REPORTS_DIR / "score_history.json"

class ReportGenerator:
    def __init__(self, reports_dir: Path = REPORTS_DIR):
        self.reports_dir = reports_dir
        self.reports_dir.mkdir(parents=True, exist_ok=True)

    def write_csv_record(self, evaluation: Dict[str, Any], fix_rec: Dict[str, Any]):
        file_exists = CSV_PATH.exists()
        headers = [
            "timestamp",
            "test_id",
            "source",
            "mode",
            "voice_validation_scope",
            "stage_reached",
            "stage_order_correct",
            "latency_score",
            "interruption_score",
            "script_compliance_score",
            "disclosure_verbatim_score",
            "overall_score",
            "verbatim_failures_count",
            "unapproved_claims_count",
            "interruption_handled",
            "customer_goal_completed",
            "root_cause",
            "smallest_fix",
            "recommended_target_file",
            "inspector_url"
        ]

        # If CSV exists but has outdated schema, rewrite with full schema
        if file_exists:
            with open(CSV_PATH, "r", encoding="utf-8") as f:
                first_line = f.readline()
                if "source" not in first_line or "voice_validation_scope" not in first_line:
                    file_exists = False

        with open(CSV_PATH, "a" if file_exists else "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(headers)

            test_id = evaluation.get("test_id", "")
            source = evaluation.get("source", "automated_test")
            writer.writerow([
                datetime.utcnow().isoformat() + "Z",
                test_id,
                source,
                evaluation.get("mode", "text"),
                evaluation.get("voice_validation_scope", "NOT_APPLICABLE"),
                evaluation.get("stage_reached", ""),
                "TRUE" if evaluation.get("stage_order_correct") else "FALSE",
                evaluation.get("latency_score", 100),
                evaluation.get("interruption_score", 100),
                evaluation.get("script_compliance_score", 100),
                evaluation.get("disclosure_verbatim_score", 100.0),
                evaluation.get("overall_score", 0),
                len(evaluation.get("verbatim_failures", [])),
                len(evaluation.get("unapproved_claims", [])),
                "TRUE" if evaluation.get("interruption_handled") else "FALSE",
                "TRUE" if evaluation.get("customer_goal_completed") else "FALSE",
                evaluation.get("root_cause", ""),
                evaluation.get("smallest_fix", "").replace("\n", " "),
                fix_rec.get("target_file", ""),
                f"http://localhost:3000/inspector?session={test_id}"
            ])

    def generate_html_summary(self, run_results: List[Dict[str, Any]]) -> str:
        total_tests = len(run_results)
        passed_tests = sum(1 for r in run_results if r["eval"].get("overall_score", 0) >= 75)
        failed_tests = total_tests - passed_tests
        pass_rate = round((passed_tests / total_tests * 100), 1) if total_tests > 0 else 0.0
        avg_score = round(
            sum(r["eval"].get("overall_score", 0) for r in run_results) / total_tests, 1
        ) if total_tests > 0 else 0.0

        all_latencies = []
        stage_counts: Dict[str, int] = {}
        for r in run_results:
            stg = r["eval"].get("stage_reached", "UNKNOWN")
            stage_counts[stg] = stage_counts.get(stg, 0) + 1
            for t in r.get("transcript", {}).get("turns", []):
                if t.get("role") == "assistant" and t.get("latency_ms"):
                    all_latencies.append(t["latency_ms"])

        avg_latency = round(sum(all_latencies) / len(all_latencies), 0) if all_latencies else 0

        now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

        # Serialized data for client-side charts & timeline
        tests_json = []
        for r in run_results:
            tests_json.append({
                "test_id": r["eval"].get("test_id"),
                "persona_id": r.get("persona_id"),
                "mode": r["eval"].get("mode", "text"),
                "score": r["eval"].get("overall_score", 0),
                "scope": r["eval"].get("voice_validation_scope", "N/A"),
                "latency_score": r["eval"].get("latency_score", 100),
                "interruption_score": r["eval"].get("interruption_score", 100),
                "script_compliance_score": r["eval"].get("script_compliance_score", 100),
                "disclosure_verbatim_score": r["eval"].get("disclosure_verbatim_score", 100.0),
                "stage_reached": r["eval"].get("stage_reached"),
                "root_cause": r["eval"].get("root_cause"),
                "smallest_fix": r["eval"].get("smallest_fix"),
                "verbatim_failures": r["eval"].get("verbatim_failures", []),
                "unapproved_claims": r["eval"].get("unapproved_claims", []),
                "inspector_url": f"http://localhost:3000/inspector?session={r['eval'].get('test_id')}",
                "turns": r.get("transcript", {}).get("turns", [])
            })

        html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Voice Agent Dashboard & Second-by-Second Inspector</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
    <style>
        :root {{
            --bg-main: #090d16;
            --bg-card: #131b2e;
            --border-card: #1e293b;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --accent-blue: #38bdf8;
            --accent-green: #34d399;
            --accent-red: #f87171;
            --accent-amber: #fbbf24;
            --accent-purple: #c084fc;
        }}
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: var(--bg-main);
            color: var(--text-main);
            padding: 28px 24px 64px;
        }}
        .container {{ max-width: 1300px; margin: 0 auto; }}
        header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 16px;
            margin-bottom: 28px;
            border-bottom: 1px solid var(--border-card);
            padding-bottom: 20px;
        }}
        .header-title h1 {{ font-size: 24px; font-weight: 700; color: var(--accent-blue); display: flex; align-items: center; gap: 8px; }}
        .header-title p {{ font-size: 13px; color: var(--text-muted); margin-top: 4px; }}
        .header-actions a {{
            padding: 8px 14px;
            background: #1e293b;
            color: #e2e8f0;
            border: 1px solid #334155;
            border-radius: 6px;
            font-size: 12px;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.15s ease;
        }}
        .header-actions a:hover {{ background: #2d3c52; color: #fff; }}

        /* Stat Cards */
        .cards-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
            gap: 16px;
            margin-bottom: 28px;
        }}
        .stat-card {{
            background: var(--bg-card);
            border: 1px solid var(--border-card);
            border-radius: 10px;
            padding: 16px 18px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }}
        .stat-card .label {{ font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 600; }}
        .stat-card .value {{ font-size: 26px; font-weight: 800; margin-top: 6px; color: #fff; }}
        .stat-card.pass .value {{ color: var(--accent-green); }}
        .stat-card.fail .value {{ color: var(--accent-red); }}

        /* Charts Section */
        .charts-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
            gap: 20px;
            margin-bottom: 32px;
        }}
        .chart-box {{
            background: var(--bg-card);
            border: 1px solid var(--border-card);
            border-radius: 10px;
            padding: 20px;
        }}
        .chart-box h3 {{ font-size: 14px; font-weight: 600; margin-bottom: 16px; color: #cbd5e1; }}
        .chart-container {{ position: relative; height: 230px; }}

        /* Second-by-Second Inspector Section */
        .inspector-panel {{
            background: var(--bg-card);
            border: 1px solid #334155;
            border-radius: 12px;
            padding: 22px;
            margin-bottom: 32px;
        }}
        .inspector-header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 12px;
            margin-bottom: 20px;
        }}
        .inspector-header h2 {{ font-size: 18px; font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 8px; }}
        select.test-picker {{
            background: #0f172a;
            border: 1px solid #334155;
            color: #fff;
            padding: 8px 14px;
            border-radius: 6px;
            font-size: 13px;
            outline: none;
        }}
        .timeline-wrapper {{
            background: #0b1120;
            border: 1px solid #1e293b;
            border-radius: 8px;
            padding: 16px;
            overflow-x: auto;
        }}
        .timeline-track-title {{
            font-size: 11px;
            text-transform: uppercase;
            font-weight: 700;
            color: var(--text-muted);
            margin-bottom: 6px;
        }}
        .timeline-track {{
            position: relative;
            height: 38px;
            background: #141e33;
            border-radius: 6px;
            margin-bottom: 12px;
            overflow: hidden;
            display: flex;
            align-items: center;
        }}
        .timeline-block {{
            position: absolute;
            height: 28px;
            border-radius: 4px;
            top: 5px;
            padding: 4px 8px;
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            cursor: pointer;
            transition: transform 0.1s ease, filter 0.15s ease;
        }}
        .timeline-block:hover {{ transform: scaleY(1.1); filter: brightness(1.2); z-index: 10; }}
        .block-avatar {{ background: #2563eb; color: #dbeafe; border: 1px solid #3b82f6; }}
        .block-user {{ background: #059669; color: #d1fae5; border: 1px solid #10b981; }}
        .block-interrupt {{ background: #dc2626; color: #fee2e2; border: 1px solid #ef4444; }}
        .block-tool {{ background: #7c3aed; color: #ede9fe; border: 1px solid #8b5cf6; }}
        
        .inspector-detail-box {{
            margin-top: 16px;
            background: #0f172a;
            border: 1px solid #1e293b;
            border-radius: 8px;
            padding: 14px 18px;
            font-size: 13px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 12px;
        }}

        /* Table */
        table {{
            width: 100%;
            border-collapse: collapse;
            background: var(--bg-card);
            border-radius: 10px;
            overflow: hidden;
            border: 1px solid var(--border-card);
        }}
        th, td {{
            padding: 12px 16px;
            text-align: left;
            font-size: 13px;
            border-bottom: 1px solid var(--border-card);
        }}
        th {{ background: #0c1322; color: var(--text-muted); font-weight: 600; font-size: 12px; text-transform: uppercase; }}
        tr:hover {{ background: #1a253d; }}
        .badge {{ padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 11px; }}
        .badge.pass {{ background: rgba(52, 211, 153, 0.15); color: #34d399; border: 1px solid rgba(52, 211, 153, 0.3); }}
        .badge.fail {{ background: rgba(248, 113, 113, 0.15); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.3); }}
        .action-link {{ color: #38bdf8; text-decoration: none; font-weight: 600; }}
        .action-link:hover {{ text-decoration: underline; }}
        code {{ background: #0c1322; padding: 2px 6px; border-radius: 4px; font-size: 12px; color: #38bdf8; }}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="header-title">
                <h1>🎙️ Digital Finance Manager — Test Intelligence Dashboard</h1>
                <p>Automated Script Compliance, Second-by-Second Experience Inspector & Flaw Diagnostics • {now_str}</p>
            </div>
            <div class="header-actions">
                <a href="http://localhost:3000/inspector" target="_blank">🔍 Open LiveAvatar Web Inspector</a>
                <a href="daily_report.md" target="_blank">📄 View Markdown Report</a>
                <a href="test_results.csv" target="_blank">📊 Export CSV</a>
            </div>
        </header>

        <!-- KPI Metrics -->
        <div class="cards-grid">
            <div class="stat-card">
                <div class="label">Total Test Sessions</div>
                <div class="value">{total_tests}</div>
            </div>
            <div class="stat-card {'pass' if pass_rate >= 80 else 'fail'}">
                <div class="label">Compliance Pass Rate</div>
                <div class="value">{pass_rate}%</div>
            </div>
            <div class="stat-card">
                <div class="label">Passed / Failed</div>
                <div class="value">{passed_tests} <span style="font-size:16px; color:#94a3b8">/ {failed_tests}</span></div>
            </div>
            <div class="stat-card">
                <div class="label">Average Score</div>
                <div class="value">{avg_score} <span style="font-size:14px; color:#94a3b8">/ 100</span></div>
            </div>
            <div class="stat-card">
                <div class="label">Average Latency</div>
                <div class="value">{int(avg_latency)} <span style="font-size:14px; color:#94a3b8">ms</span></div>
            </div>
        </div>

        <!-- Charts Grid -->
        <div class="charts-grid">
            <div class="chart-box">
                <h3>Script Compliance (Pass vs Fail)</h3>
                <div class="chart-container">
                    <canvas id="passFailChart"></canvas>
                </div>
            </div>
            <div class="chart-box">
                <h3>Stage Progression Funnel</h3>
                <div class="chart-container">
                    <canvas id="stageFunnelChart"></canvas>
                </div>
            </div>
            <div class="chart-box">
                <h3>Turn-by-Turn Latency Distribution</h3>
                <div class="chart-container">
                    <canvas id="latencyChart"></canvas>
                </div>
            </div>
        </div>

        <!-- Second-by-Second Inspector Panel -->
        <div class="inspector-panel">
            <div class="inspector-header">
                <h2>⏱️ Second-by-Second Call Experience Inspector</h2>
                <div style="display:flex; align-items:center; gap: 12px;">
                    <label style="font-size: 13px; color: var(--text-muted);">Select Run:</label>
                    <select id="testSelect" class="test-picker" onchange="renderTimeline(this.value)"></select>
                    <a id="extInspectorLink" href="#" target="_blank" class="action-link" style="font-size: 13px;">🔗 Open in Next.js Inspector</a>
                </div>
            </div>

            <div class="timeline-wrapper">
                <div class="timeline-track-title">👤 Customer Speech Track</div>
                <div id="userTrack" class="timeline-track"></div>

                <div class="timeline-track-title">🤖 Max AI Utterance Track</div>
                <div id="avatarTrack" class="timeline-track"></div>

                <div class="timeline-track-title">⚡ Tool Dispatches & Screen Events Track</div>
                <div id="toolTrack" class="timeline-track"></div>
            </div>

            <div id="inspectorDetail" class="inspector-detail-box">
                <span>Select any block above to inspect verbatim text, exact second timestamps, latency gaps, and compliance flags.</span>
            </div>
        </div>

        <!-- Test Results Breakdown Table -->
        <h2 style="font-size: 18px; margin-bottom: 14px; color: #cbd5e1;">Test Execution Matrix</h2>
        <table>
            <thead>
                <tr>
                    <th>Test ID</th>
                    <th>Persona</th>
                    <th>Mode</th>
                    <th>Scope</th>
                    <th>Stage Reached</th>
                    <th>Latency</th>
                    <th>Interrupt</th>
                    <th>Compliance</th>
                    <th>Disclosure</th>
                    <th>Overall</th>
                    <th>Failures & Root Cause</th>
                    <th>Inspector Action</th>
                </tr>
            </thead>
            <tbody>
                {''.join([f'''
                <tr>
                    <td><code>{r["eval"].get("test_id")}</code></td>
                    <td><strong>{r.get("persona_id")}</strong></td>
                    <td>{r["eval"].get("mode")}</td>
                    <td><span class="badge" style="background:#1e293b; color:#38bdf8;">{r["eval"].get("voice_validation_scope", "N/A")}</span></td>
                    <td>{r["eval"].get("stage_reached")}</td>
                    <td>{r["eval"].get("latency_score", 100)}</td>
                    <td>{r["eval"].get("interruption_score", 100)}</td>
                    <td>{r["eval"].get("script_compliance_score", 100)}</td>
                    <td>{r["eval"].get("disclosure_verbatim_score", 100.0)}%</td>
                    <td><span class="badge {'pass' if r['eval'].get('overall_score',0) >= 75 else 'fail'}">{r['eval'].get('overall_score',0)} / 100</span></td>
                    <td>
                        <small>{("<br>".join(r["eval"].get("verbatim_failures", [])[:2]) if r["eval"].get("verbatim_failures") else "Clean")}</small>
                        <br><strong style="font-size:11px; color:#38bdf8">Cause: {r["eval"].get("root_cause", "none")}</strong>
                    </td>
                    <td><a href="http://localhost:3000/inspector?session={r['eval'].get('test_id')}" target="_blank" class="action-link">Open Inspector ↗</a></td>
                </tr>
                ''' for r in run_results])}
            </tbody>
        </table>
    </div>

    <script>
        const testsData = {json.dumps(tests_json)};

        // 1. Pass / Fail Donut Chart
        new Chart(document.getElementById('passFailChart'), {{
            type: 'doughnut',
            data: {{
                labels: ['Passed', 'Failed'],
                datasets: [{{
                    data: [{passed_tests}, {failed_tests}],
                    backgroundColor: ['#10b981', '#ef4444'],
                    borderWidth: 0
                }}]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {{ legend: {{ position: 'bottom', labels: {{ color: '#94a3b8' }} }} }}
            }}
        }});

        // 2. Stage Funnel Chart
        const stageData = {json.dumps(stage_counts)};
        new Chart(document.getElementById('stageFunnelChart'), {{
            type: 'bar',
            data: {{
                labels: Object.keys(stageData),
                datasets: [{{
                    label: 'Sessions Reaching Stage',
                    data: Object.values(stageData),
                    backgroundColor: '#38bdf8'
                }}]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                scales: {{
                    y: {{ beginAtZero: true, ticks: {{ color: '#94a3b8' }} }},
                    x: {{ ticks: {{ color: '#94a3b8' }} }}
                }},
                plugins: {{ legend: {{ display: false }} }}
            }}
        }});

        // 3. Latency Distribution Chart
        const latencies = {json.dumps(all_latencies)};
        const latBuckets = {{ '<200ms': 0, '200-500ms': 0, '500-1000ms': 0, '1000-2000ms': 0, '>2000ms': 0 }};
        latencies.forEach(l => {{
            if (l < 200) latBuckets['<200ms']++;
            else if (l < 500) latBuckets['200-500ms']++;
            else if (l < 1000) latBuckets['500-1000ms']++;
            else if (l < 2000) latBuckets['1000-2000ms']++;
            else latBuckets['>2000ms']++;
        }});

        new Chart(document.getElementById('latencyChart'), {{
            type: 'bar',
            data: {{
                labels: Object.keys(latBuckets),
                datasets: [{{
                    label: 'Turns in Latency Bucket',
                    data: Object.values(latBuckets),
                    backgroundColor: '#c084fc'
                }}]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                scales: {{
                    y: {{ beginAtZero: true, ticks: {{ color: '#94a3b8' }} }},
                    x: {{ ticks: {{ color: '#94a3b8' }} }}
                }},
                plugins: {{ legend: {{ display: false }} }}
            }}
        }});

        // Populate test picker
        const selectEl = document.getElementById('testSelect');
        testsData.forEach(t => {{
            const opt = document.createElement('option');
            opt.value = t.test_id;
            opt.textContent = `${{t.persona_id}} (${{t.test_id.substring(0, 16)}}) - ${{t.score}}pts`;
            selectEl.appendChild(opt);
        }});

        function renderTimeline(testId) {{
            const test = testsData.find(t => t.test_id === testId);
            if (!test) return;

            document.getElementById('extInspectorLink').href = test.inspector_url;

            const userTrack = document.getElementById('userTrack');
            const avatarTrack = document.getElementById('avatarTrack');
            const toolTrack = document.getElementById('toolTrack');

            userTrack.innerHTML = '';
            avatarTrack.innerHTML = '';
            toolTrack.innerHTML = '';

            const totalSec = Math.max(...test.turns.map(t => t.elapsed_sec || 0), 10);

            test.turns.forEach(t => {{
                const startPct = ((t.elapsed_sec || 0) / totalSec) * 92;
                const widthPct = Math.max(6, 10);

                const block = document.createElement('div');
                block.className = 'timeline-block';
                block.style.left = `${{startPct}}%`;
                block.style.width = `${{widthPct}}%`;

                if (t.role === 'user') {{
                    block.className += t.is_interruption ? ' block-interrupt' : ' block-user';
                    block.textContent = `${{t.elapsed_sec}}s: ${{t.text.substring(0, 20)}}...`;
                    userTrack.appendChild(block);
                }} else {{
                    block.className += ' block-avatar';
                    block.textContent = `${{t.elapsed_sec}}s: ${{t.text.substring(0, 24)}}...`;
                    avatarTrack.appendChild(block);
                }}

                block.onclick = () => {{
                    document.getElementById('inspectorDetail').innerHTML = `
                        <div>
                            <strong>${{t.speaker}}</strong> @ ${{t.elapsed_sec}}s (Turn #${{t.turn_id}}) | 
                            Stage: <code>${{t.stage_id || 'N/A'}}</code> | Latency: <strong>${{t.latency_ms || 0}}ms</strong>
                            <div style="margin-top:4px; color:#cbd5e1;">"${{t.text}}"</div>
                        </div>
                        <a href="${{test.inspector_url}}" target="_blank" class="action-link">Open in /inspector ↗</a>
                    `;
                }};

                if (t.tool_calls && t.tool_calls.length > 0) {{
                    const tBlock = document.createElement('div');
                    tBlock.className = 'timeline-block block-tool';
                    tBlock.style.left = `${{startPct}}%`;
                    tBlock.style.width = `${{widthPct}}%`;
                    tBlock.textContent = t.tool_calls.map(tc => tc.name).join(', ');
                    tBlock.onclick = block.onclick;
                    toolTrack.appendChild(tBlock);
                }}
            }});
        }}

        if (testsData.length > 0) {{
            renderTimeline(testsData[0].test_id);
        }}
    </script>
</body>
</html>
"""
        with open(HTML_PATH, "w", encoding="utf-8") as f:
            f.write(html_content)

        return html_content

    def generate_daily_report(self, run_results: List[Dict[str, Any]]) -> str:
        total_tests = len(run_results)
        passed_tests = sum(1 for r in run_results if r["eval"].get("overall_score", 0) >= 75)
        failed_tests = total_tests - passed_tests
        pass_rate = round((passed_tests / total_tests * 100), 1) if total_tests > 0 else 0.0

        avg_score = round(
            sum(r["eval"].get("overall_score", 0) for r in run_results) / total_tests, 1
        ) if total_tests > 0 else 0.0

        # Track before/after history
        history = self._load_score_history()
        previous_avg = history.get("last_avg_score", avg_score)
        history["last_avg_score"] = avg_score
        history["runs_count"] = history.get("runs_count", 0) + 1
        self._save_score_history(history)

        delta = round(avg_score - previous_avg, 1)
        trend_str = f"+{delta}" if delta > 0 else str(delta)

        # Aggregate failures
        all_failures: List[str] = []
        for r in run_results:
            ev = r["eval"]
            for vf in ev.get("verbatim_failures", []):
                all_failures.append(f"Verbatim/TTS: {vf}")
            for uc in ev.get("unapproved_claims", []):
                all_failures.append(f"Claim/Policy: {uc}")
            for lat in ev.get("latency_issues", []):
                all_failures.append(f"High Latency: {lat}")
            if not ev.get("interruption_handled", True):
                all_failures.append(f"Interruption Not Honored (Test {ev.get('test_id')})")

        # Top 5 failures
        failure_counts: Dict[str, int] = {}
        for f in all_failures:
            failure_counts[f] = failure_counts.get(f, 0) + 1
        top_failures = sorted(failure_counts.items(), key=lambda x: x[1], reverse=True)[:5]

        # Build Markdown content
        now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
        md = []
        md.append("# AI Voice Agent Testing Skill — Daily Compliance & Quality Report\n")
        md.append(f"**Generated:** {now_str}\n")
        md.append("## 1. Executive Summary\n")
        md.append(f"| Metric | Value | Status |")
        md.append(f"| :--- | :--- | :--- |")
        md.append(f"| **Total Tests Executed** | `{total_tests}` | — |")
        md.append(f"| **Passed Tests (>=75%)** | `{passed_tests}` | {'🟢 Healthy' if passed_tests == total_tests else '🟡 Needs Review'} |")
        md.append(f"| **Failed Tests** | `{failed_tests}` | {'🔴 Attention' if failed_tests > 0 else '🟢 None'} |")
        md.append(f"| **Pass Rate** | `{pass_rate}%` | {'🟢 Passed' if pass_rate >= 80 else '🔴 Critical'} |")
        md.append(f"| **Average Compliance Score** | `{avg_score} / 100` | Trend: `{trend_str} pts` |")
        md.append("\n---\n")

        md.append("## 2. Test Execution Breakdown\n")
        md.append("| Test ID | Persona | Mode | Scope | Stage Reached | Latency | Interruption | Compliance | Disclosure | Overall Score | Voice Validation | Inspector Link |")
        md.append("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |")
        for r in run_results:
            ev = r["eval"]
            score = ev.get("overall_score", 0)
            mode = ev.get("mode", "TEXT")
            scope = ev.get("voice_validation_scope", "N/A")
            lat_sc = ev.get("latency_score", 100)
            int_sc = ev.get("interruption_score", 100)
            scr_sc = ev.get("script_compliance_score", 100)
            disc_sc = ev.get("disclosure_verbatim_score", 100.0)

            if mode == "REAL_VOICE":
                mode_label = "`🟢 REAL_VOICE`"
                voice_val = "✅ PASSED (FULL_FLOW Verified)" if ev.get("voice_validation_passed") else "❌ FAILED"
            elif mode == "MOCK_VOICE":
                mode_label = "`🟡 MOCK_VOICE`"
                voice_val = "⚠️ NOT EVALUATED (Simulated)"
            else:
                mode_label = f"`{mode}`"
                voice_val = "— (Text Mode)"

            inspector_link = f"[Open Inspector](http://localhost:3000/inspector?session={ev.get('test_id')})"
            md.append(
                f"| `{ev.get('test_id')}` | **{r.get('persona_id')}** | {mode_label} | `{scope}` | `{ev.get('stage_reached')}` | `{lat_sc}` | `{int_sc}` | `{scr_sc}` | `{disc_sc}%` | **{score} / 100** | {voice_val} | {inspector_link} |"
            )
        md.append("\n---\n")

        md.append("## 3. Top 5 Detected Failure Modes\n")
        if top_failures:
            for idx, (f_name, count) in enumerate(top_failures, 1):
                md.append(f"{idx}. **{f_name}** (`{count}` occurrences)")
        else:
            md.append("🎉 *Zero recurring failure modes detected! All script compliance criteria met.*")
        md.append("\n---\n")

        md.append("## 4. Recommended Prompt & State-Machine Fixes (Human Approval Queue)\n")
        has_fixes = False
        for r in run_results:
            fix = r.get("fix", {})
            if fix.get("root_cause") != "none" and fix.get("recommended_change"):
                has_fixes = True
                md.append(f"### Test `{r['eval'].get('test_id')}` ({r.get('persona_id')})\n")
                md.append(f"- **Target File:** `{fix.get('target_file')}`")
                md.append(f"- **Root Cause:** `{fix.get('root_cause')}`")
                md.append(f"- **Recommendation:** {fix.get('recommended_change')}")
                if fix.get("diff_preview"):
                    md.append(f"```diff\n{fix.get('diff_preview')}\n```")
                md.append(f"- **Rationale:** {fix.get('rationale')}\n")

        if not has_fixes:
            md.append("✨ *No prompt or code fixes needed. Current codebase satisfies all script tests.*")

        report_text = "\n".join(md)
        with open(MARKDOWN_PATH, "w", encoding="utf-8") as f:
            f.write(report_text)

        # Generate full visual HTML dashboard with graphs & timeline inspector
        self.generate_html_summary(run_results)

        return report_text

    def _load_score_history(self) -> Dict[str, Any]:
        if HISTORY_PATH.exists():
            try:
                with open(HISTORY_PATH, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _save_score_history(self, history: Dict[str, Any]):
        try:
            with open(HISTORY_PATH, "w", encoding="utf-8") as f:
                json.dump(history, f, indent=2)
        except Exception:
            pass
