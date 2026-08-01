from enum import Enum
from .llm_client import generate_cloud_response, generate_local_response

class Route(Enum):
    LOCAL = "LOCAL"
    CLOUD = "CLOUD"

def analyze_intent(message: str) -> Route:
    """
    Analyzes the user's message to determine if it requires heavy cloud reasoning
    or fast local processing.
    """
    cloud_triggers = ["code", "explain", "analyze", "complex", "essay", "write", "summary"]
    
    message_lower = message.lower()
    for trigger in cloud_triggers:
        if trigger in message_lower:
            return Route.CLOUD
            
    # Default to local for fast OS control or simple queries
    return Route.LOCAL

def process_message(message: str) -> str:
    """
    Main entry point for the Cognitive Engine to process a message.
    """
    route = analyze_intent(message)
    
    if route == Route.CLOUD:
        print(f"[Router] Routing to CLOUD model for: {message}")
        return generate_cloud_response(message)
    else:
        print(f"[Router] Routing to LOCAL model for: {message}")
        return generate_local_response(message)
