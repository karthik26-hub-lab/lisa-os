import os
import json
from datetime import datetime

MEMORY_FILE = os.path.join(os.path.dirname(__file__), "long_term_memory.json")

def _load_memory():
    if not os.path.exists(MEMORY_FILE):
        return {"preferences": {}, "projects": {}, "active_tasks": {}}
    try:
        with open(MEMORY_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {"preferences": {}, "projects": {}, "active_tasks": {}}

def _save_memory(data):
    with open(MEMORY_FILE, "w") as f:
        json.dump(data, f, indent=4)

def save_preference(key: str, value: str):
    """Saves a user preference to long term memory."""
    mem = _load_memory()
    mem["preferences"][key] = {
        "value": value,
        "updated_at": datetime.now().isoformat()
    }
    _save_memory(mem)
    print(f"[MEMORY] Saved preference: {key} -> {value}")

def update_project(project_name: str, context: str):
    """Saves context about a specific project."""
    mem = _load_memory()
    mem["projects"][project_name] = {
        "context": context,
        "updated_at": datetime.now().isoformat()
    }
    _save_memory(mem)
    print(f"[MEMORY] Updated project {project_name}: {context}")

def start_task(task_name: str, description: str):
    """Starts tracking a new active task."""
    mem = _load_memory()
    mem["active_tasks"][task_name] = {
        "description": description,
        "started_at": datetime.now().isoformat()
    }
    _save_memory(mem)
    print(f"[MEMORY] Started task: {task_name}")

def complete_task(task_name: str):
    """Marks a task as completed and removes it from active tasks."""
    mem = _load_memory()
    if task_name in mem["active_tasks"]:
        del mem["active_tasks"][task_name]
        _save_memory(mem)
        print(f"[MEMORY] Completed task: {task_name}")

def get_full_memory_context() -> str:
    """Returns a formatted string of all relevant memory for the LLM."""
    mem = _load_memory()
    
    context = []
    
    if mem["active_tasks"]:
        context.append("--- ACTIVE TASKS ---")
        for k, v in mem["active_tasks"].items():
            context.append(f"{k}: {v['description']}")
            
    if mem["preferences"]:
        context.append("--- USER PREFERENCES ---")
        for k, v in mem["preferences"].items():
            context.append(f"{k}: {v['value']}")
            
    if mem["projects"]:
        context.append("--- PROJECT KNOWLEDGE ---")
        for k, v in mem["projects"].items():
            context.append(f"{k}: {v['context']}")
            
    return "\n".join(context) if context else "(No long-term memory stored yet)"
