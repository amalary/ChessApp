# backend/app/main.py
from fastapi import FastAPI, UploadFile, File, Depends
from fastapi.middleware.cors import CORSMiddleware
from app.routers import health
from app.auth0 import get_current_user  # 👈 Auth0 dependency 


app = FastAPI()

origins = [
    "http://localhost:3000",
    "http://localhost:3001",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Existing health router
app.include_router(health.router)


@app.get("/")
async def root():
    return {"message": "Backend is running"}


# 👇 Protected by Auth0 – must send a valid Bearer token
@app.post("/solve")
async def solve(
    image: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    return {
        "solution": "Qh7#",  # stub for now
        "user": {
            "sub": user.get("sub"),
            "email": user.get("email"),
        },
    }
