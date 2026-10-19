-- 人工脚本，程序不会执行。
-- 在远程 D1 上运行：把已经抓进来的无效草稿标为已驳回，并把广东省人社厅列表地址改成当前栏目。
-- 判断和 src/shared/policyPage.ts 的导航标题、网站名称、脚本标题一致。只改 status = '待审核' 的行。

UPDATE policy_sources
SET list_url = 'https://hrss.gd.gov.cn/zcfg/'
WHERE name = '广东省人社厅政策'
  AND list_url = 'https://hrss.gd.gov.cn/zwgk/xxgkml/zcfg/';

UPDATE policy_drafts
SET status = '已驳回',
    review_note = '批量标记：疑似无效抓取',
    reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = '待审核'
  AND (
    title IS NULL
    OR length(trim(title)) < 8
    OR title LIKE '%var %'
    OR title LIKE '%function%'
    OR title LIKE '%{%'
    OR title LIKE '%}%'
    OR title LIKE '%&nbsp;%'
    OR title LIKE '%&#%'
    OR title IN (
      '搜一下',
      '搜索',
      '检索',
      '公众查询',
      '首页',
      '网站首页',
      '登录',
      '注册',
      '联系我们',
      '网站地图',
      '政务微信',
      '政务微博',
      '简体',
      '繁体',
      '英文版',
      '更多',
      '下一页',
      '上一页',
      '返回顶部',
      'English',
      '国家税务总局广东省税务局',
      '国家税务总局',
      '国家税务总局深圳市税务局',
      '广东省人力资源和社会保障厅',
      '广东省人民政府',
      '深圳市人民政府',
      '广东省财政厅',
      '中华人民共和国人力资源和社会保障部'
    )
  );
