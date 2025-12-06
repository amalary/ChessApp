# from fastapi import APIRouter, UploadFile, File, Depends
# from app.auth0 import get_current_user

# router = APIRouter()

# @router.post("/solve")
# async def solve(
#     image: UploadFile = File(...),
#     user: dict = Depends(get_current_user),
# ):
#     return {
#         "solution": "Qh7#",
#         "user": {
#             "sub": user.get("sub"),
#             "email": user.get("email"),
#         },
#     }
