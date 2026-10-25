<<<<<<< HEAD
# CyberTwin X

Local-first cybersecurity dashboard: a live Digital Twin of your computer plus a Dead Internet Detector
that flags repetitive text. Findings are indicators only, never proof of AI or bot authorship.

## Install and run on Windows
1. Install Python 3.10+ from python.org (tick "Add Python to PATH").
2. Open PowerShell in this folder and run:
```
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```
3. Open http://127.0.0.1:5000 in your browser and press **Start**.

For network connections and full process details, open PowerShell **as Administrator** before step 2.
Charts load Chart.js from a CDN, so they need an internet connection; all numbers work offline.

## Files
- `app.py` - Flask API (`/api/system`, `/api/metrics`, `/api/processes`, `/api/network`, `/api/analyze`, `/api/history`)
- `templates/index.html`, `static/css/style.css`, `static/js/script.js` - the interface
- `history.json` - created automatically; delete it from the History page

## Security
- Binds to 127.0.0.1 only. Never expose it publicly without authentication.
- Pasted text is analyzed as data and never executed. No passwords or personal data are collected.
- All monitoring data is real and comes from this computer. If the backend is down, the page says so instead of showing fake numbers.

## Test it
Open Dead Internet Detector, click **Load sample posts**, then **Analyze**.
=======
# CyberTwin-X
CyberTwinX is a local-first cybersecurity dashboard built with Flask,, Chart.js and three.js. It monitors your computer’s CPU, memory, disk, processes and network in live charts and a 3D digital twin, with alerts for high usage. Its Dead Internet Detector scores repeated phrases and similarity in pasted posts, flagging indicators, never proof.
>>>>>>> 096d2f4fa68c02d772eb7fae2fc2ee4db5479a25
