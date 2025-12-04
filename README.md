# ChessApp   


                        +-----------------------------+
                        |           User              |
                        |  - Web browser              |
                        |  - On laptop / phone        |
                        +--------------+--------------+
                                       |
                                       | HTTPS
                                       v
                        +-----------------------------+
                        |        Frontend (Next.js)   |
                        |  - React + TypeScript       |
                        |  - Runs on Vercel/GCP/Docker|
                        +--------------+--------------+
                                       |
                                       | HTTP POST /solve
                                       |  (multipart/form-data with image)
                                       v
+---------------------------+     +------------------------------+
|  Google Cloud Storage     |     |  Backend API (FastAPI)       |
|  (GCS Bucket)             |<--->|  - /health, /solve           |
|  - chess puzzle images    |     |  - Python, uvicorn           |
|  - Optional: solutions    |     |  - Talks to GCS + OpenAI     |
+-------------+-------------+     +------------------------------+
              ^                                   |
              |                                   |
              |                                   | HTTPS (OpenAI API)
              |                                   v
              |                      +------------------------------+
              |                      |     OpenAI Vision + GPT     |
              |                      |  - Reads chess puzzle image |
              |                      |  - Returns SAN moves        |
              |                      +------------------------------+
              |
              |
       (DevOps / Infra)
+-------------+-------------+
|  Jenkins CI/CD            |
|  - Builds Docker images   |
|  - Lints/tests frontend   |
|  - Lints/tests backend    |
|  - Pushes to registry     |
+---------------------------+
