const docx = require('docx');
const fs = require('fs');
const path = require('path');

const { Document, Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;

const doc = new Document({
    sections: [{
        properties: {
            page: {
                margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
            }
        },
        children: [
            new Paragraph({
                text: "配件库存管理系统",
                heading: HeadingLevel.TITLE,
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 }
            }),
            new Paragraph({
                text: "项目说明文档",
                alignment: AlignmentType.CENTER,
                spacing: { after: 600 }
            }),

            new Paragraph({ text: "项目概述", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
            new Paragraph({
                children: [
                    new TextRun({ text: "配件库存管理系统", bold: true }),
                    new TextRun(" 是一款运行在 Android 平台上的手机维修配件库存管理应用。采用 Cordova 混合开发框架，纯前端 JavaScript 实现，数据存储在本地（localStorage + IndexedDB），无需后端服务器。")
                ],
                spacing: { after: 200 }
            }),
            new Paragraph({
                text: "主要功能包括：配件管理（增删改查、分类、搜索）、入库/出库/调拨操作、库存预警、价格表管理（图片 + Excel）、数据导出/导入备份。",
                spacing: { after: 200 }
            }),

            new Paragraph({ text: "技术栈", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
            new Paragraph({ text: "前端框架：Cordova 12.0.1", spacing: { after: 100 } }),
            new Paragraph({ text: "UI 层：纯 HTML + CSS + JavaScript", spacing: { after: 100 } }),
            new Paragraph({ text: "数据存储：localStorage + IndexedDB", spacing: { after: 100 } }),
            new Paragraph({ text: "构建工具：Node.js + Gradle 8.10.2 + Android SDK (API 34)", spacing: { after: 100 } }),
            new Paragraph({ text: "开发语言：JavaScript + HTML/CSS", spacing: { after: 200 } }),

            new Paragraph({ text: "项目结构", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
            new Paragraph({ text: "D:\\APK\\", bold: true, spacing: { after: 100 } }),
            new Paragraph({ text: "├── www/                          # Web 前端源码", spacing: { after: 60 } }),
            new Paragraph({ text: "│   ├── index.html               # 主页面", spacing: { after: 60 } }),
            new Paragraph({ text: "│   ├── css/style.css            # 样式表", spacing: { after: 60 } }),
            new Paragraph({ text: "│   └── js/                      # JavaScript 模块", spacing: { after: 60 } }),
            new Paragraph({ text: "│       ├── app.js               # 应用主入口", spacing: { after: 60 } }),
            new Paragraph({ text: "│       ├── database.js          # 数据存储层", spacing: { after: 60 } }),
            new Paragraph({ text: "│       ├── parts.js             # 配件管理", spacing: { after: 60 } }),
            new Paragraph({ text: "│       ├── inventory.js         # 入库/出库/调拨", spacing: { after: 60 } }),
            new Paragraph({ text: "│       ├── warehouse.js         # 仓库管理", spacing: { after: 60 } }),
            new Paragraph({ text: "│       ├── price.js             # 价格表管理", spacing: { after: 60 } }),
            new Paragraph({ text: "│       ├── dashboard.js         # 首页仪表盘", spacing: { after: 60 } }),
            new Paragraph({ text: "│       └── export.js            # 数据导出/备份", spacing: { after: 100 } }),
            new Paragraph({ text: "├── platforms/android/            # Cordova Android 平台", spacing: { after: 60 } }),
            new Paragraph({ text: "├── build.js                       # 构建脚本", spacing: { after: 60 } }),
            new Paragraph({ text: "├── build.bat                      # 构建入口", spacing: { after: 60 } }),
            new Paragraph({ text: "├── config.xml                     # Cordova 配置", spacing: { after: 60 } }),
            new Paragraph({ text: "└── VERSION.txt                    # 版本号（自动递增）", spacing: { after: 200 } }),

            new Paragraph({ text: "构建流程", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
            new Paragraph({ text: "双击 build.bat 执行：1) 版本号自动递增 2) 清理缓存 3) 同步源码 4) cordova build 5) 签名输出到 build_output/", spacing: { after: 200 } }),

            new Paragraph({ text: "核心功能", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
            new Paragraph({ text: "配件管理：添加/编辑/删除配件，设置分类、新旧件、供应商、存放位置、低库存预警。支持拍照上传和自定义分类。", spacing: { after: 100 } }),
            new Paragraph({ text: "库存操作：入库（增加库存+记录单价）、出库（扣减库存）、调拨（仓库间转移）。所有操作生成可追溯的时间戳记录。", spacing: { after: 100 } }),
            new Paragraph({ text: "价格表：上传图片或 Excel 文件，内置 Excel 查看器支持多 Sheet 切换。", spacing: { after: 100 } }),
            new Paragraph({ text: "数据导出：库存明细（Excel）、操作记录（Excel）、价格表（ZIP）、全量备份（JSON）。", spacing: { after: 200 } }),

            new Paragraph({ text: "环境配置", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
            new Paragraph({ text: "JDK：Eclipse Adoptium JDK 17.0.19", spacing: { after: 100 } }),
            new Paragraph({ text: "Gradle：8.10.2（系统安装）", spacing: { after: 100 } }),
            new Paragraph({ text: "Android SDK：E:\\SDK，compileSdk 34，build-tools 34.0.0", spacing: { after: 100 } }),
            new Paragraph({ text: "签名：release-key.jks，alias: parts-manager", spacing: { after: 200 } }),

            new Paragraph({ text: "注意事项", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
            new Paragraph({ text: "1. 构建前需先卸载旧版本 App，否则签名冲突无法安装", spacing: { after: 100 } }),
            new Paragraph({ text: "2. 数据存储于本地，卸载 App 会丢失所有数据，建议定期备份", spacing: { after: 100 } }),
            new Paragraph({ text: "3. 长按图片可保存到相册或删除", spacing: { after: 100 } }),
            new Paragraph({ text: "4. 版本号在构建时自动递增，无需手动修改", spacing: { after: 200 } }),
        ]
    }]
});

const outputPath = path.join('D:', 'APK', '项目说明文档.docx');
docx.Packer.toBuffer(doc).then(buffer => {
    fs.writeFileSync(outputPath, buffer);
    console.log("Created: " + outputPath);
});
