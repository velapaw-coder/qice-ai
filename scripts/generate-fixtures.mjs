/**
 * 生成明确标注的合成测试文件。姓名、证件号、信用代码都是算法造出来的，不是真人资料。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import * as XLSX from "xlsx";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "fixtures", "fake");
mkdirSync(outDir, { recursive: true });

const CHARSET = "0123456789ABCDEFGHJKLMNPQRTUWXY";
const WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
function makeUscc(body17) {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += CHARSET.indexOf(body17[i]) * WEIGHTS[i];
  let check = 31 - (sum % 31);
  if (check === 31) check = 0;
  return body17 + CHARSET[check];
}

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECK = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"];
function makeChineseId(area, birth, seq) {
  const body = `${area}${birth}${seq}`;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(body[i]) * ID_WEIGHTS[i];
  return body + ID_CHECK[sum % 11];
}

export const AIHUA_NAME = "深圳爱华国际教育科技有限公司";
export const AIHUA_USCC = makeUscc("91440300MA5QCEA01");
export const SOLE_NAME = "东莞市测试纸品厂（合成）";
export const SOLE_USCC = makeUscc("92441900MA5QCEA01");

const quarters = [
  ["2025-10-01", "2025-12-31"],
  ["2026-01-01", "2026-03-31"],
  ["2026-04-01", "2026-06-30"],
  ["2026-07-01", "2026-09-30"],
];

function vatRows(name, uscc, extra) {
  return [
    ["增值税及附加税费申报表（一般纳税人适用）"],
    ["合成测试数据，非真实申报"],
    ["纳税人名称", name],
    ["纳税人识别号", uscc],
    ["增值税纳税人类型", "一般纳税人"],
    extra,
    [],
    ["所属期起", "所属期止", "销售额", "应纳税额", "附加税费"],
    ...quarters.map(([start, end]) => [start, end, 600000, 18000, 2160]),
  ];
}

function writeBook(filename, rows, sheetName) {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, sheet, sheetName);
  XLSX.writeFile(wb, join(outDir, filename));
}

function ssRows(name, uscc, people, title = "深圳市社会保险费缴费明细（合成测试数据）") {
  const rows = [
    [title],
    ["合成测试数据，非真实人员"],
    ["单位名称", name],
    ["统一社会信用代码", uscc],
    ["社保经办机构", name.includes("东莞") ? "东莞市税务局" : "深圳市税务局"],
    ["费款所属期", "2026年09月"],
    [],
    ["序号", "姓名", "证件号码", "险种", "个人缴费", "单位缴费", "缴费基数", "参保开始日期"],
  ];
  let n = 1;
  for (const person of people) {
    for (const [ins, personal] of [["养老保险", 640], ["医疗保险", 140], ["失业保险", 20]]) {
      rows.push([n, person.name, person.id, ins, personal, 1000, 8000, person.start]);
      n += 1;
    }
  }
  return rows;
}

const aihuaPeople = [];
for (let i = 1; i <= 43; i++) {
  const young = i <= 4;
  const seq = String(i).padStart(3, "0");
  aihuaPeople.push({
    name: `合成员工${String(i).padStart(2, "0")}`,
    id: makeChineseId("440300", young ? "20040115" : "19880520", seq),
    start: young ? "2025-06-01" : "2018-01-01",
  });
}

writeBook("爱华-增值税申报表-合成.xlsx", vatRows(AIHUA_NAME, AIHUA_USCC, ["登记机关", "深圳市市场监督管理局"]), "增值税");
writeBook("爱华-社保清单-合成.xlsx", ssRows(AIHUA_NAME, AIHUA_USCC, aihuaPeople), "社保");
writeBook(
  "个体户-增值税申报表-合成.xlsx",
  vatRows(SOLE_NAME, SOLE_USCC, ["备注", "个体工商户，合成测试，非真实主体"]),
  "增值税",
);
writeBook(
  "个体户-社保清单-合成.xlsx",
  ssRows(
    SOLE_NAME,
    SOLE_USCC,
    [{ name: "合成经营者01", id: makeChineseId("441900", "19800101", "001"), start: "2019-01-01" }],
    "个体工商户社保清单（合成测试数据，非真实人员）",
  ),
  "社保",
);

const pdf = await PDFDocument.create();
pdf.registerFontkit(fontkit);
const fontBytes = readFileSync("/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf");
const font = await pdf.embedFont(fontBytes, { subset: true });
const page = pdf.addPage([595, 842]);
const lines = [
  "增值税及附加税费申报表（一般纳税人适用）",
  "合成测试数据，非真实申报",
  `纳税人名称：${AIHUA_NAME}`,
  `纳税人识别号：${AIHUA_USCC}`,
  "增值税纳税人类型：一般纳税人",
  "登记机关：深圳市市场监督管理局",
  "所属期起    所属期止    销售额    应纳税额    附加税费",
  ...quarters.map(([start, end]) => `${start}    ${end}    600000    18000    2160`),
];
lines.forEach((line, index) => {
  page.drawText(line, { x: 36, y: 800 - index * 22, size: 11, font });
});
writeFileSync(join(outDir, "爱华-增值税申报表-合成.pdf"), await pdf.save());

writeFileSync(
  join(outDir, "README.md"),
  `# 合成测试资料

这些文件只用于开发和验收，**不是真实企业、真实人员和真实申报**。

- 企业名「${AIHUA_NAME}」来自产品验收案例的虚构主体。
- 统一社会信用代码按 GB 32100 校验位算法生成：爱华 \`${AIHUA_USCC}\`，个体户 \`${SOLE_USCC}\`。
- 证件号码按校验位算法生成，姓名为「合成员工」「合成经营者」。
- 金额是为了让规则试算得到确定区间而设定的，不代表任何真实纳税情况。

爱华社保：43 人，其中 4 名青年（2004-01-15 出生，2025-06-01 参保），每人养老 640 + 医疗 140 + 失业 20 = 800 元。
对应高校毕业生社保补贴上沿约为 4 × 800 × 25% × 12 = 9600 元，取整后 10000 元。
`,
);

console.log(JSON.stringify({ aihuaUscc: AIHUA_USCC, soleUscc: SOLE_USCC, people: aihuaPeople.length, dir: outDir }, null, 2));
