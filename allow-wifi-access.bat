@echo off
chcp 65001 >nul
echo ===================================================
echo  CardVault: 開放本機 WiFi 區網連線 (Port 3000)
echo ===================================================
echo.
echo [1/2] 正在為 Port 3000 新增 Windows 防火牆入站允許規則...
netsh advfirewall firewall add rule name="PokeCard-Port3000" dir=in action=allow protocol=TCP localport=3000

echo.
echo [2/2] 正在將 Wi-Fi 2 網路類別設為「私人網路 (Private)」...
powershell -Command "Set-NetConnectionProfile -InterfaceAlias 'Wi-Fi 2' -NetworkCategory Private"

echo.
echo ===================================================
echo  ✅ 防火牆規則設定完成！
echo  📱 手機請連上相同 WiFi 後，於瀏覽器開啟：
echo     http://192.168.50.3:3000
echo ===================================================
pause
