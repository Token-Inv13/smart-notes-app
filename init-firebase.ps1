$process = Start-Process -FilePath "npx" -ArgumentList "firebase-tools init functions" -NoNewWindow -PassThru -RedirectStandardInput "$pwd\input.txt"
Start-Sleep -Seconds 2
"y`nInitialize`nTypeScript`ny`ny`ny`n" | Set-Content "$pwd\input.txt"
$process.WaitForExit()
