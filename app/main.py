from fastapi import FastAPI

app = FastAPI(
    title="AdAnalyzer",
    description="Facebook Ads + Shopify analytics powered by Claude AI",
    version="0.1.0",
)


@app.get("/health")
async def health_check():
    return {"status": "ok"}
