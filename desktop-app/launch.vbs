Dim oShell
Set oShell = CreateObject("WScript.Shell")

' Remove ELECTRON_RUN_AS_NODE so Electron runs as a full app (not Node.js mode)
On Error Resume Next
oShell.Environment("USER").Remove("ELECTRON_RUN_AS_NODE")
On Error GoTo 0

' Launch using full path to node so it works regardless of PATH
Dim nodeExe, script, appDir
nodeExe = "C:\Program Files\nodejs\node.exe"
appDir  = "D:\adanalyzer\desktop-app"
script  = appDir & "\scripts\dev.js"

oShell.Run """" & nodeExe & """ """ & script & """", 0, False
