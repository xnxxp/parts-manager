# 配件库存管理：项目交接

更新：2026-10-26（北京时间）；工作目录：D:/APK；当前 Android 交付版本：2.2.3；iOS 适配源码已准备，尚未完成云编译与真机验证。

## 目标与验收

管理个人工作配件，随时知道有没有、剩多少、放哪里，并保留补货计划和操作记录。验收要求：按位置独立增减、不出现负库存；同一搜索/分类/位置范围内“库存充足（件）＋快用完（件）＝顶部库存（件）”；补货分批入库不重复计数；保存、删除、恢复失败不产生新旧混合数据；无效备份不覆盖原数据；只有对应文件保存成功才标记自动备份完成。

## 已定方案及理由

- 继续使用 Cordova/Android 原生壳。结构化数据存 localStorage 的 parts_manager_{parts,inventory,records,warehouses,prices}，图片存 IndexedDB parts_manager_images；当前实现没有使用 SQLite。inventory 是已有库存明细的数量依据，旧数据缺少明细时兼容 part.qty。
- 位置数量、配件总数及流水通过 DB.commitStores 整体提交；parts_manager_stock_journal 保存回滚日志，启动先恢复未完成提交。恢复备份先校验五张表、编号、数量、关联及图片，再用新图片键暂存、整体提交，避免失败时覆盖原照片。
- 原生保存接口只有一个无请求编号的回调，所以手动导出、图片保存、自动备份串行排队。30 秒无回调会报超时并保留待备份标记；旧结果到达前不发送下一次保存，避免错误归属。自动备份另用数据修订号防止漏掉保存期间的修改。
- 本次仅修改网页资源，使用已有 APK 壳重打包并沿用原签名；没有升级依赖或重建原生代码，原生变更必须完整构建。未新增仓库管理/调拨界面，仅兼容旧仓库数据和历史调拨记录。

## 已完成修改

1. 多位置数量、搜索/分类/位置/库存状态筛选、位置选择后的快捷加减；数量校验及库存写入回滚保护。
2. 补货清单支持计划、取消、分批到货及实际数量入库；详情按北京时间显示最近记录，可继续加载历史。
3. 库存状态互斥，库存充足和快用完统一按件统计；已用完按种统计，顶部与筛选范围一致。
4. 修复审查确认的五项问题：恢复回滚丢原数据、配件删除部分成功、备份校验不足、图片读取失败仍产出成功备份、共用保存回调误判自动备份成功。照片和价格表删除也在数据提交成功后才清理未被其他条目引用的图片。
5. v2.2.3 首页精简：统计合并为一行，金额和上次操作收进“概览”；搜索与位置筛选常驻，分类折叠，库存状态使用紧凑分段栏。卡片突出名称、数量与位置，去掉分类彩点/彩边，保留快捷加减，编辑仍可从详情进入；超过两个位置显示“另 N 处”，选定位置时只显示该位置。添加按钮移到右上角，避免遮住卡片操作。本次未修改补货、价格表或导出页功能。

## 当前分支、文件与交付状态

- D:/APK 及父目录不是 Git 仓库（git rev-parse / git status 均确认，目录无 .git）。当前分支：不适用；未提交状态：无法通过 Git 比较，修改直接保存在本地文件，未提交或推送。
- 源码、平台 assets/www 已同步；package.json、package-lock.json、config.xml、页面版本和缓存版本均为 2.2.3，Android versionCode 为 20203。旧 APK 保留。
- 最新交付：[配件库存管理-v2.2.3.apk](./配件库存管理-v2.2.3.apk)，8,105,173 字节；SHA-256：3BBC6926395A1F0F3D1AE8B0857F147862DB7C0D87600FA835783A47A2CF3131。

## 测试与证据

- npm test：64 项全套通过（原有 56 项＋新增 8 项 iOS 适配回归），覆盖表写入失败/回滚、容量限制、恢复中断重启、非法备份、图片读写失败、删除失败、并发保护、保存结果归属与超时迟到回调，以及 iOS 就绪等待、每请求回调归属、导出取消、备份修订号、图片选择与保存、前台自动备份。
- APK 的 v2/v3 签名和 zipalign 检查通过；aapt 确认包名 com.repair.partsmanager、版本 2.2.3/20203、最低 API 24、目标 API 34；26 个网页资源与源码逐字节一致，444 个原生文件与原壳一致，resources.arsc 保持 STORE。
- 签名证书 SHA-256：3788991930ea14d5b8341840b22205513ab1920bfbbd742a834410621403835a，与旧版一致。
- 既有浏览器验证：320/390 像素宽度下的库存查询、位置过滤、补货和历史；测试数量 11＋1＝12，背包范围 0＋2＝2。截图位于 build/v2.2.0-{restock,history}-preview.png、build/v2.2.1-stock-preview.png。它们是测试数据，且不代表 v2.2.2 真机验证。
- v2.2.3 独立浏览器验证：320/390 像素无横向溢出；检查概览展开、分类收起、组合筛选/清除、搜索/空结果、多位置选择、零库存禁用、按选定位置增减、详情及编辑入口、空库存添加。没有页面运行错误。390 像素下首张卡片从约 400px 提前到 312px。截图：build/home-ui-{before,after}-390.png、build/home-ui-after-320.png、build/home-ui-filters-320.png、build/home-ui-location-320.png；均为隔离的测试数据。验证脚本：build/check-home-ui.cjs；打包与资源核对：build/package-home-release.cjs；交付校验信息：build/home-ui-release-result.json。

## iOS 适配与云构建（准备中）

- 目标：使用个人证书在描述文件覆盖的设备上安装。已在本地确认 P12 含匹配私钥、与描述文件一致、未过期并覆盖指定设备。未进行吊销状态在线查询，也尚未完成实际 IPA 签名或安装。
- `ios/build-settings.json` 中的包名按当前描述文件限定的 App ID 配置。更换证书/描述文件时需重新核对包名及设备覆盖范围；应用显示名称仍为“配件库存管理”。
- `node scripts/prepare-ios.js` 生成独立的 `build/ios-project/`，复用当前网页业务代码，加入 iOS 运行时适配及本地 Cordova 插件；不修改 Android 网页源码或既有 APK。锁定 Cordova CLI 13.0.0、cordova-ios 8.1.1，最低 iOS 13。
- `ios/parts-native/` 提供文件导出选择器、照片选择/拍摄及原子本机备份写入。手动导出/图片保存通过系统“文件”选择位置，取消不报告保存成功；iOS 的 Cordova 回调按请求独立归属，不使用 Android 的无编号回调队列。
- iOS 本机自动备份每 5 秒在前台检查，并保留原有切后台触发；保存成功且修订号一致才清除待备份标志。文件在应用 Documents/Backups，可通过“文件”App 查看。卸载应用会删除本机数据和本机备份，应定期手动导出至其他位置。
- `.github/workflows/build-ios.yml` 在 `ios-port` 分支推送或手动启动时，用 macOS/Xcode 编译未签名 IPA，产物保留 7 天。工作流不读取、上传或保存个人证书及密码。云编译仍需发布代码并实际运行成功，当前尚未启动。
- `node scripts/package-ios-source.js` 生成 `build/parts-manager-ios-source-2.2.3.zip`，仅打包网页、iOS 适配、必要脚本、测试、工作流和交接文档，排除证书、私钥、描述文件与整个 build 目录。
- Windows 本地签名工具为官方 zsign v1.1.3，下载包 SHA-256 已与发布方提供的摘要核对；位于 build/zsign-v1.1.3/。本机签名入口：使用工作区 Python 执行 `build/sign-ios-local.py <未签名IPA路径>`，输出根目录的 `配件库存管理-iOS-v2.2.3.ipa`。证书材料保持在用户指定的本机文件夹，签名脚本及材料不进入源码包。
- 当前验证：8 项 iOS JS 适配测试及原有 56 项测试全部通过；生成的 JS、配置 XML 语法检查通过。隔离浏览器检查了 320/390 像素页面、备份导出到 Cordova 适配器和无横向溢出/页面异常；原生接口为模拟，截图为 build/ios-home-preview-{320,390}.png。Windows 无法完成 Xcode 编译，原生插件、实际系统选择器和安装行为仍待云编译及真机验证。
- GitHub 已连接；同项目仓库 `xnxxp/parts-manager` 为公开仓库，其 main 分支现有 package.json 版本为 2.0.20，早于本地 2.2.3。用户已授权向独立 `ios-port` 分支发布本次适配源码并触发云编译，不覆盖默认分支；证书和密码仅留在本机用于签名。

官方依据：[Cordova iOS 环境要求](https://cordova.apache.org/docs/en/latest/guide/platforms/ios/index.html)、[iOS 原生插件接口](https://cordova.apache.org/docs/en/latest/guide/platforms/ios/plugin.html)、[Apple 指定设备分发要求](https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile/)、[GitHub macOS 执行环境](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、[zsign 跨平台签名说明](https://github.com/zhlynn/zsign)。

## 未解决问题与下一步

- 五项确认缺陷已修复；v2.2.3 尚未在真实手机安装验证。异常路径测试使用隔离存储/IndexedDB/原生接口模拟，不等同于设备实测。
- 恢复中断可能留下未引用图片；当前保留原数据优先，未实现全面清理。保存超时后若原生一直不回调，本次运行会阻止后续保存，需要检查下载目录并重开应用。
- 下一步：先在手机导出原数据备份，再覆盖安装 v2.2.3，检查首页统计/分类展开与快捷操作，并验证原数据保留、位置加减、分批入库、带图片的备份恢复，以及手动保存与后台自动备份。若出现具体失败，再针对复现修复；无需扩展功能或升级依赖。

## 相关文件与恢复工作入口

- 业务：[stock.js](./www/js/stock.js)、[parts.js](./www/js/parts.js)、[restock.js](./www/js/restock.js)；持久化与备份：[database.js](./www/js/database.js)、[export.js](./www/js/export.js)；保存队列/导航：[app.js](./www/js/app.js)；价格表：[price.js](./www/js/price.js)。
- 界面/缓存：www/index.html、www/css/style.css、www/service-worker.js；测试：tests/stock.test.js、tests/robustness.test.js；预览：npm start（127.0.0.1:8081）。
- 网页重打包：node scripts/package-apk.js；输入壳：platforms/android/app/build/outputs/apk/release/app-release-unsigned.apk；输出：build/parts-manager-2.2.3-unsigned.apk。先同步 www 到 platforms/android/app/src/main/assets/www，保持版本配置一致。本次改动前的文件副本在 build/home-ui-before-20261018/。
- 对齐/签名：使用 build/android-sdk/build-tools/34.0.0 下 zipalign.exe 的 -p -f 4，再用 apksigner.bat sign；JDK：build/jdk-17.0.11+9；原密钥：build/release-key.jks，别名 parts-manager，沿用现有本地签名配置，不生成新密钥。签后运行 apksigner verify、zipalign -c -p 4 并核对包内网页资源。aapt 遇中文文件名时使用 build/parts-manager-2.2.3.apk 副本。
- [BUILD.md](./BUILD.md) 为旧版原生构建参考，其中 SQLite、仓库管理及调拨界面说明已过时；当前状态与网页打包流程以本交接为准。
