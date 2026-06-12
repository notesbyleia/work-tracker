# Reply Radar

A small static MVP for tracking work that depends on other people replying on time.

## Run locally

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000>.

## Deploy on GitHub Pages

This app is static, so GitHub Pages can serve it directly from the root of the
`main` branch.

1. Push this repository to GitHub.
2. In GitHub, open **Settings > Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Set branch to `main` and folder to `/root`.
5. Save.

The site will be available at:

```text
https://<username>.github.io/<repo-name>/
```
