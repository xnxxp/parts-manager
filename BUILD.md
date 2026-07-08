# 配件库存管理 APK - 构建指南

## 环境要求
- Node.js >= 16
- Java JDK >= 11 (推荐 JDK 17)
- Android SDK (API 34, Build Tools 34)
- Gradle 8.x

## 快速开始

### 1. 安装 Cordova CLI
```bash
npm install -g cordova
```

### 2. 初始化项目
```bash
cd APK
npm install
cordova platform add android@12
```

### 3. 构建 APK
```bash
# Debug build (自动签名)
cordova build android -- --arm64-v8a

# Release build (需自行签名)
cordova build android --release -- --arm64-v8a
```

### 4. 输出位置
- Debug: `platforms/android/app/build/outputs/apk/debug/app-debug.apk`
- Release: `platforms/android/app/build/outputs/apk/release/app-release-unsigned.apk`

### 5. 签名 Release APK
```bash
# 生成签名密钥（仅一次）
keytool -genkey -v -keystore my-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias parts-manager

# 签名 APK
apksigner sign --ks my-release-key.jks --out 配件库存管理.apk platforms/android/app/build/outputs/apk/release/app-release-unsigned.apk
```

## 功能清单
- 配件管理（名称、型号、分类、规格、图片、最低库存）
- 多仓库管理（自定义仓库名称、位置）
- 出入库操作（入库、出库、仓库间调拨）
- 库存不足预警
- 价格管理（拿货价、零售价、供应商、价格表图片）
- 数据导出（Excel: 配件列表、库存明细、价格表、操作记录）
- 数据备份/恢复（JSON格式）
- 64位 APK (armeabi-v8a)

## 应用说明
- 最低支持 Android 7.0 (API 24)
- 目标 Android 14 (API 34)
- 所有数据存储在本地 SQLite 数据库中
- 无需网络连接即可使用
