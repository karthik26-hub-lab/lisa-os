import os
from google import genai
from dotenv import load_dotenv
from PIL import ImageGrab

load_dotenv()

def test_vision():
    api_key = os.environ.get("GEMINI_API_KEY")
    client = genai.Client(api_key=api_key)
    
    print("Taking screenshot...")
    img = ImageGrab.grab()
    img = img.convert("RGB")
    
    print("Calling Gemini...")
    response = client.models.generate_content(
        model='gemini-3.1-flash-lite',
        contents=["Describe this image briefly.", img]
    )
    print("Response:", response.text)

if __name__ == "__main__":
    test_vision()
