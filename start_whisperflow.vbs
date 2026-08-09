Set WshShell = CreateObject("WScript.Shell")
' Run the Python backend using the virtual environment without opening a command window (0 = hide window)
WshShell.Run "cmd.exe /c cd backend && .venv\Scripts\python.exe main.py", 0, False
