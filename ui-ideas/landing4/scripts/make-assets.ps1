$b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
$bytes = [Convert]::FromBase64String($b64)
New-Item -ItemType Directory -Force -Path 'd:\PROJECTS\GRAPH\landing4\public' | Out-Null
New-Item -ItemType Directory -Force -Path 'd:\PROJECTS\GRAPH\landing4\src\assets' | Out-Null
[IO.File]::WriteAllBytes('d:\PROJECTS\GRAPH\landing4\public\logo.png', $bytes)
[IO.File]::WriteAllBytes('d:\PROJECTS\GRAPH\landing4\src\assets\hero-flowers.png', $bytes)
Write-Host 'done'
