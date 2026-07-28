; HelixCraft NSIS 自定义脚本
; 用于在安装向导中添加内测版提醒
; 注意: electron-builder 已自动包含 MUI2.nsh，此处不可重复 include

; 欢迎页面 - 内测版提醒
!define MUI_WELCOMEPAGE_TITLE "欢迎安装 HelixCraft - 内测版"
!define MUI_WELCOMEPAGE_TEXT "感谢您参与 HelixCraft 内部测试！$\r$\n$\r$\n当前版本为内部测试版（Beta），仅供测试使用，请勿传播。$\r$\n$\r$\n如发现任何问题，请及时反馈给开发团队。$\r$\n$\r$\n点击 下一步 继续安装。"

; 完成页面 - 内测版提醒
!define MUI_FINISHPAGE_TITLE "HelixCraft 安装完成"
!define MUI_FINISHPAGE_TEXT "HelixCraft 已成功安装到您的计算机。$\r$\n$\r$\n提醒：当前为内部测试版（Beta），请勿传播给他人。$\r$\n$\r$\n点击 完成 启动应用程序。"
