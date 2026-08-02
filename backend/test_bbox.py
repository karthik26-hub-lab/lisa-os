import os
from google import genai
from dotenv import load_dotenv
from PIL import ImageGrab

load_dotenv()

def test_bbox():
    api_key = os.environ.get("GEMINI_API_KEY")
    client = genai.Client(api_key=api_key)
    
    print("Taking screenshot...")
    img = ImageGrab.grab(all_screens=True).convert("RGB")
    
    print("Asking Gemini for bounding box of the taskbar (bottom of the screen)...")
    prompt = "Find the Windows taskbar. Return its bounding box in the format [ymin, xmin, ymax, xmax] where values are 0-1000."
    response = client.models.generate_content(
        model='gemini-3.1-flash',
        contents=[prompt, img]
    )
    print("Response:", response.text)

if __name__ == "__main__":
    test_bbox()
