# 配件库存管理：项目交接

更新：2026-10-26（北京时间）；工作目录：D:/APK；当前源码：2.2.5，已有 iOS 交付：2.2.4，Android 交付：2.2.3。v2.2.5 在温润配色上加入玻璃导航与控件，已通过本机检查，等待新安装包交付；尚未真机安装验证。

## 目标与验收

管理个人工作配件，随时知道有没有、剩多少、放哪里，并保留补货计划和操作记录。验收要求：按位置独立增减、不出现负库存；同一搜索/分类/位置范围内“库存充足（件）＋快用完（件）＝顶部库存（件）”；补货分批入库不重复计数；保存、删除、恢复失败不产生新旧混合数据；无效备份不覆盖原数据；只有对应文件保存成功才标记自动备份完成。

## 已定方案及理由

- 共用网页业务层，Android 沿用既有原生壳，iOS 使用隔离的 Cordova 工程。结构化数据存 localStorage 的 parts_manager_{parts,inventory,records,warehouses,prices}，图片存 IndexedDB parts_manager_images；当前实现没有使用 SQLite。inventory 是已有库存明细的数量依据，旧数据缺少明细时兼容 part.qty。
- 位置数量、配件总数及流水通过 DB.commitStores 整体提交；parts_manager_stock_journal 保存回滚日志，启动先恢复未完成提交。恢复备份先校验五张表、编号、数量、关联及图片，再用新图片键暂存、整体提交，避免失败时覆盖原照片。
- Android 原生保存接口只有一个无请求编号的回调，所以手动导出、图片保存、自动备份串行排队。30 秒无回调会报超时并保留待备份标记；旧结果到达前不发送下一次保存，避免错误归属。iOS 使用每请求独立的 Cordova 回调。自动备份另用数据修订号防止漏掉保存期间的修改。
- Android v2.2.3 使用已有 APK 壳重打包并沿用原签名；iOS 交付经 macOS 云编译和 Windows 本地签名。本次只调整网页外观与版本/缓存，不升级依赖或修改原生接口。未新增仓库管理/调拨界面，仅兼容旧仓库数据和历史调拨记录。

## 已完成修改

1. 多位置数量、搜索/分类/位置/库存状态筛选、位置选择后的快捷加减；数量校验及库存写入回滚保护。
2. 补货清单支持计划、取消、分批到货及实际数量入库；详情按北京时间显示最近记录，可继续加载历史。
3. 库存状态互斥，库存充足和快用完统一按件统计；已用完按种统计，顶部与筛选范围一致。
4. 修复审查确认的五项问题：恢复回滚丢原数据、配件删除部分成功、备份校验不足、图片读取失败仍产出成功备份、共用保存回调误判自动备份成功。照片和价格表删除也在数据提交成功后才清理未被其他条目引用的图片。
5. v2.2.3 首页精简：统计合并为一行，金额和上次操作收进“概览”；搜索与位置筛选常驻，分类折叠，库存状态使用紧凑分段栏。卡片突出名称、数量与位置，去掉分类彩点/彩边，保留快捷加减，编辑仍可从详情进入；超过两个位置显示“另 N 处”，选定位置时只显示该位置。添加按钮移到右上角，避免遮住卡片操作。本次未修改补货、价格表或导出页功能。
6. v2.2.4 温润简约 UI：新增离线 `www/css/warm.css`，米白底色和低饱和鼠尾草绿统一首页、补货、价格表、导出及弹窗；导航、导出与照片入口改用本地 SVG 线条图标。导出改为分组列表，自动备份采用带标签的开关；按钮、表单与卡片统一，并修复窄屏弹窗取消按钮被挤成竖排的问题。仅调整界面与版本/缓存，不改库存、持久化或原生接口。
7. v2.2.5 玻璃质感：参照 Apple Liquid Glass 的导航/控件层次，在 `warm.css` 中加入悬浮胶囊导航、半透明背景模糊、高光边缘、柔和投影、选中胶囊滑动与悬浮圆角弹窗；保留米白/鼠尾草绿及清晰的浅色库存卡片。通过 CSS 能力检测保留旧版 WebKit 的选中样式和不透明降级，响应减少透明度/增强对比度/减少动态效果偏好。属于网页视觉近似，不是 UIKit/SwiftUI 的系统级动态折射材质。

## 当前分支、文件与交付状态

- D:/APK 及父目录不是 Git 仓库（git rev-parse / git status 均确认，目录无 .git）。本地分支不适用，无法通过 Git 比较未提交改动；另通过 GitHub 接口向已授权的 ios-port 分支同步发布源码。
- package.json、package-lock.json、config.xml、页面与缓存源码版本均为 2.2.5。Android 平台 assets/www 与 APK 仍保留 2.2.3/20203，本次只重新交付 iOS；未声明旧 APK 含有新版界面。
- 最新交付：[配件库存管理-v2.2.3.apk](./配件库存管理-v2.2.3.apk)，8,105,173 字节；SHA-256：3BBC6926395A1F0F3D1AE8B0857F147862DB7C0D87600FA835783A47A2CF3131。

## 测试与证据

- npm test：64 项全套通过（原有 56 项＋新增 8 项 iOS 适配回归），覆盖表写入失败/回滚、容量限制、恢复中断重启、非法备份、图片读写失败、删除失败、并发保护、保存结果归属与超时迟到回调，以及 iOS 就绪等待、每请求回调归属、导出取消、备份修订号、图片选择与保存、前台自动备份。
- APK 的 v2/v3 签名和 zipalign 检查通过；aapt 确认包名 com.repair.partsmanager、版本 2.2.3/20203、最低 API 24、目标 API 34；26 个网页资源与源码逐字节一致，444 个原生文件与原壳一致，resources.arsc 保持 STORE。
- 签名证书 SHA-256：3788991930ea14d5b8341840b22205513ab1920bfbbd742a834410621403835a，与旧版一致。
- 既有浏览器验证：320/390 像素宽度下的库存查询、位置过滤、补货和历史；测试数量 11＋1＝12，背包范围 0＋2＝2。截图位于 build/v2.2.0-{restock,history}-preview.png、build/v2.2.1-stock-preview.png。它们是测试数据，且不代表 v2.2.2 真机验证。
- v2.2.3 独立浏览器验证：320/390 像素无横向溢出；检查概览展开、分类收起、组合筛选/清除、搜索/空结果、多位置选择、零库存禁用、按选定位置增减、详情及编辑入口、空库存添加。没有页面运行错误。390 像素下首张卡片从约 400px 提前到 312px。截图：build/home-ui-{before,after}-390.png、build/home-ui-after-320.png、build/home-ui-filters-320.png、build/home-ui-location-320.png；均为隔离的测试数据。验证脚本：build/check-home-ui.cjs；打包与资源核对：build/package-home-release.cjs；交付校验信息：build/home-ui-release-result.json。
- v2.2.4 本地和云端 64 项测试通过。隔离浏览器检查了 320/390/768 像素下的四个页面、详情/编辑/入库/上传/导出弹窗、分类和位置筛选、按位置加减、零库存禁用、自动备份开关与导出到 iOS 适配器；无横向溢出和页面异常。截图等待动画结束，位于 build/warm-{home,restock,price,export,detail,edit,receive,upload,download}-{320,390,768}.png。原生选择器使用模拟，不能替代真机验证。脚本：build/check-warm-ui.cjs；记录：build/warm-ui-checks.json；修改前副本：build/warm-ui-before-20261026/。
- v2.2.5 本机 64 项测试通过；`build/check-glass-ui.cjs` 检查 320/390/768 像素下的四页及主要弹窗、筛选、位置加减、备份开关与导出，同时确认滚动后末张卡片的加号可点击，以及减少透明度和减少动态效果的降级生效。截图：build/glass-{home,restock,price,export,detail,edit,receive,upload,download,opaque}-{320,390,768}.png。没有横向溢出或页面异常，原生接口仍为模拟。修改前副本：build/glass-ui-before-20261026/。

## iOS 适配与交付

- 目标：使用个人证书在描述文件覆盖的设备上安装。已确认 P12 含匹配私钥、与描述文件一致、未过期并覆盖指定设备；zsign 查询 Apple OCSP 返回 Valid。已在 Windows 本地完成 IPA 签名，尚未在设备安装验证。
- `ios/build-settings.json` 中的包名按当前描述文件限定的 App ID 配置。更换证书/描述文件时需重新核对包名及设备覆盖范围；应用显示名称仍为“配件库存管理”。
- `node scripts/prepare-ios.js` 生成独立的 `build/ios-project/`，复用当前网页业务代码，加入 iOS 运行时适配及本地 Cordova 插件；不修改 Android 网页源码或既有 APK。必须预建 platforms/，防止 Cordova 将父目录识别为工程根。锁定 Cordova CLI 13.0.0、cordova-ios 8.1.1，最低 iOS 13。
- `ios/parts-native/` 提供文件导出选择器、照片选择/拍摄及原子本机备份写入。手动导出/图片保存通过系统“文件”选择位置，取消不报告保存成功；iOS 的 Cordova 回调按请求独立归属，不使用 Android 的无编号回调队列。
- iOS 本机自动备份每 5 秒在前台检查，并保留原有切后台触发；保存成功且修订号一致才清除待备份标志。文件在应用 Documents/Backups，可通过“文件”App 查看。卸载应用会删除本机数据和本机备份，应定期手动导出至其他位置。
- `.github/workflows/build-ios.yml` 在 `ios-port` 分支推送或手动启动时，用 macOS/Xcode 编译未签名 IPA，产物保留 7 天。工作流不读取、上传或保存个人证书及密码。通过显式的 `cordova-ios@8.1.1` 安装平台，使用 iOS 8 固定的 App.xcworkspace / App scheme，应用产物名为 PartsManager.app。
- `node scripts/package-ios-source.js` 生成 `build/parts-manager-ios-source-2.2.4.zip`，仅打包网页、iOS 适配、必要脚本、测试、工作流和交接文档，排除证书、私钥、描述文件与整个 build 目录。
- Windows 本地签名工具为官方 zsign v1.1.3，下载包 SHA-256 已与发布方提供的摘要核对；位于 build/zsign-v1.1.3/。本机签名入口：使用工作区 Python 执行 `build/sign-ios-local.py <未签名IPA路径>`，输出根目录的 `配件库存管理-iOS-v2.2.4.ipa`。证书材料保持在用户指定的本机文件夹，签名脚本及材料不进入源码包。
- 当前验证：8 项 iOS JS 适配测试及原有 56 项测试在本地和云端全部通过；生成的 JS、配置 XML 语法检查通过。隔离浏览器检查了 320/390 像素页面、备份导出到 Cordova 适配器和无横向溢出/页面异常；原生接口为模拟，截图为 build/ios-home-preview-{320,390}.png。
- 云编译：[成功任务 40322573248](https://github.com/xnxxp/parts-manager/actions/runs/40322573248)，源码 commit：e0a0919d6a78dac9cbd4cda17a3cbe103e8f5857。工程生成、原生插件安装、arm64 设备编译、IPA 打包和产物上传均通过；main 仍为 4b555ebb0a5bc2f607877c0b6ac441ec36262b06。
- iOS 最新交付：[配件库存管理-iOS-v2.2.4.ipa](./配件库存管理-iOS-v2.2.4.ipa)，2,239,710 字节；SHA-256：ECA48F2D81D23F64BF10C6B72A3ADAFC08F982D3239B9C1443DE503D83C57EF0。仅适用于当前描述文件登记的设备，未上传到 GitHub。
- 产物检查：云端下载 ZIP 与 GitHub 摘要一致，未签名 IPA 与构建生成的 SHA256.txt 一致；签名 IPA 的包名、版本、iOS 最低版本、arm64 架构、原生插件映射、权限说明和文件访问配置正确；23 个业务网页资源（含 warm.css）与生成目录逐字节一致，并确认包含 iOS Cordova 运行时、描述文件、资源签名清单和 Mach-O 签名。记录：build/ios-release-result.json、build/ios-cloud-state.json；核对脚本：build/verify-ios-package.py。
- GitHub 已连接；用户已授权在公开仓库 [xnxxp/parts-manager 的 ios-port 分支](https://github.com/xnxxp/parts-manager/tree/ios-port) 发布本次适配。main 保持原状态（package.json 2.0.20）；证书和密码始终留在本机，仅云端生成的未签名 IPA 作为 Actions 产物保存。

官方依据：[Cordova iOS 环境要求](https://cordova.apache.org/docs/en/latest/guide/platforms/ios/index.html)、[iOS 原生插件接口](https://cordova.apache.org/docs/en/latest/guide/platforms/ios/plugin.html)、[Apple 指定设备分发要求](https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile/)、[GitHub macOS 执行环境](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、[zsign 跨平台签名说明](https://github.com/zhlynn/zsign)。

## 未解决问题与下一步

- 五项确认缺陷已修复；Android v2.2.3 / iOS v2.2.4 尚未在真实手机安装验证。异常路径测试使用隔离存储/IndexedDB/原生接口模拟，不等同于设备实测。
- iOS 已编译和签名，但仍需在已登记的 iPhone 上验证安装、拍照/相册、文件导出取消与成功、带图片备份恢复、切后台与重开后的数据保留。迁移时可先从 Android 导出 JSON 备份，再在 iOS 的恢复数据入口选择该文件；两端仍使用相同备份结构。
- 恢复中断可能留下未引用图片；当前保留原数据优先，未实现全面清理。保存超时后若原生一直不回调，本次运行会阻止后续保存，需要检查下载目录并重开应用。
- 下一步：先在手机导出原数据备份，再覆盖安装 iOS v2.2.4，检查温润简约界面、首页统计/分类展开与快捷操作，并验证原数据保留、位置加减、分批入库、带图片的备份恢复，以及手动保存与后台自动备份。若出现具体失败，再针对复现修复；无需扩展功能或升级依赖。

## 相关文件与恢复工作入口

- 业务：[stock.js](./www/js/stock.js)、[parts.js](./www/js/parts.js)、[restock.js](./www/js/restock.js)；持久化与备份：[database.js](./www/js/database.js)、[export.js](./www/js/export.js)；保存队列/导航：[app.js](./www/js/app.js)；价格表：[price.js](./www/js/price.js)。
- 界面/缓存：www/index.html、www/css/style.css、www/css/warm.css、www/service-worker.js；测试：tests/stock.test.js、tests/robustness.test.js、tests/ios.test.js；预览：npm start（127.0.0.1:8081）。
- 网页重打包：node scripts/package-apk.js；输入壳：platforms/android/app/build/outputs/apk/release/app-release-unsigned.apk；输出按 package.json 版本生成。先同步 www 到 platforms/android/app/src/main/assets/www，保持版本配置一致。build/package-home-release.cjs 是 2.2.3 的旧打包入口，重新交付 Android 时需先核对其固定版本断言；本次未重打包 Android。
- 对齐/签名：使用 build/android-sdk/build-tools/34.0.0 下 zipalign.exe 的 -p -f 4，再用 apksigner.bat sign；JDK：build/jdk-17.0.11+9；原密钥：build/release-key.jks，别名 parts-manager，沿用现有本地签名配置，不生成新密钥。签后运行 apksigner verify、zipalign -c -p 4 并核对包内网页资源。aapt 遇中文文件名时使用 build/parts-manager-2.2.3.apk 副本。
- [BUILD.md](./BUILD.md) 为旧版原生构建参考，其中 SQLite、仓库管理及调拨界面说明已过时；当前状态与网页打包流程以本交接为准。
