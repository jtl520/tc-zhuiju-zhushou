// 地址规则回归测试及真实浏览器中的本地 DOM 集成测试；不安装依赖。
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const http = require('http');
const {spawn} = require('child_process');
const assert = require('assert/strict');
const source = fs.readFileSync(path.join(__dirname, '..', 'zhuiju.txt'), 'utf8');
new vm.Script(source);
const helpers = source.slice(source.indexOf('    function readPaginationNumber('), source.indexOf('    function createShell('));
const context = vm.createContext({URL});
vm.runInContext('const PAGE_PARAMETER = ' + source.match(/const PAGE_PARAMETER = (.*);/)[1] + ';\n' + helpers, context);
let count = 0;

/** 用公开的页码样本验证推导结果，包括拒绝不可靠的规则。 */
function check(name, samples, target, expected) {
    const actual = context.inferPaginationUrl(samples.map(([page, url]) => ({page, url})), target, 'https://example.com/list');
    assert.equal(actual, expected, name);
    count++;
}
check('保留查询词和排序', [[2, '/list?q=a%26b&sort=new&page=2'], [3, '/list?q=a%26b&sort=new&page=3']], 27,
    'https://example.com/list?q=a%26b&sort=new&page=27');
check('路径分页保留帖子 ID', [[2, '/thread-913-2-1.html'], [3, '/thread-913-3-1.html']], 42,
    'https://example.com/thread-913-42-1.html');
check('目录分页', [[2, '/tags/topic/2/'], [3, '/tags/topic/3/']], 50, 'https://example.com/tags/topic/50/');
check('搜索偏移量 start', [[2, '/search?q=test&start=10'], [3, '/search?q=test&start=20']], 12,
    'https://example.com/search?q=test&start=110');
check('搜索偏移量 pn', [[2, '/s?wd=test&pn=10'], [3, '/s?wd=test&pn=20']], 1, 'https://example.com/s?wd=test&pn=0');
check('零基页码', [[2, '/list?page=1'], [3, '/list?page=2']], 10, 'https://example.com/list?page=9');
check('hash 路由', [[2, '/#/list?page=2'], [3, '/#/list?page=3']], 8, 'https://example.com/#/list?page=8');
check('补零页码', [[2, '/page/002'], [3, '/page/003']], 10, 'https://example.com/page/010');
check('单个样本不能推导', [[2, '/list?page=2']], 8, null);
check('多数字位变化拒绝推导', [[2, '/list?page=2&id=2'], [3, '/list?page=3&id=3']], 8, null);
check('第三个样本冲突', [[2, '/list?page=2'], [3, '/list?page=3'], [4, '/list?page=8']], 9, null);
check('跨域拒绝', [[2, 'https://other.example/list/2'], [3, 'https://other.example/list/3']], 9, null);
check('同区域多种规则冲突', [[2, '/a/2'], [3, '/a/3'], [2, '/b/2'], [3, '/b/3']], 9, null);
check('无规律 ID 不推导', [[2, '/item/381'], [3, '/item/421']], 9, null);
check('首屏数量不同的偏移量', [[2, '/search?q=python&first=8'], [3, '/search?q=python&first=18']], 6,
    'https://example.com/search?q=python&first=48');
assert.equal(context.inferPaginationUrl([
    {page: 2, url: 'https://www.google.com/search?q=python+documentation&start=10&ved=pageA'},
    {page: 3, url: 'https://www.google.com/search?q=python+documentation&start=20&ved=pageB'}
], 12, 'https://www.google.com/search?q=python+documentation'), 'https://www.google.com/search?q=python+documentation&start=110');
assert.equal(context.inferPaginationUrl([
    {page: 2, url: 'https://www.bing.com/search?q=python+documentation&first=8&FORM=PERE'},
    {page: 3, url: 'https://www.bing.com/search?q=python+documentation&first=18&FORM=PERE1'}
], 6, 'https://www.bing.com/search?q=python+documentation'), null);
count += 2;
const samples = [{page: 2, url: '/tags/topic/2/'}, {page: 3, url: '/tags/topic/3/'}];
assert.equal(context.inferPaginationPage(samples, 'https://example.com/tags/topic/180/', 'https://example.com/tags/topic/'), 180);
assert.equal(context.getCurrentPageParameter('https://example.com/?page=2').page, 2);
assert.equal(context.getCurrentPageParameter('https://example.com/?page=0'), null);
assert.equal(context.getCurrentPageParameter('https://example.com/?page=2&p=3'), null);
assert.equal(context.getCurrentPageParameter('https://example.com/?start=20'), null);
console.log(`PASS: ${count + 5} URL and syntax checks`);

/** 在隔离的无头浏览器中运行完整油猴脚本及 DOM 场景，导航由测试替身记录。 */
async function browserTests() {
    const browser = [process.env.TC_TEST_BROWSER,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find((file) => file && fs.existsSync(file));
    if (!browser) throw new Error('缺少 Chrome/Edge；请设置 TC_TEST_BROWSER 后运行浏览器测试');
    const browserTests = fs.readFileSync(path.join(__dirname, 'pagination.browser.js'), 'utf8');
    const instrumented = source.replace("    'use strict';", "    'use strict';\n    const location = window.__testLocation;")
        .replace('    const startPageAssistant =', '    window.__paginationTest = {collectPaginationRegions, initializePageJumper};\n    const startPageAssistant =');
    const html = `<!doctype html><meta charset="utf-8"><title>Pagination tests</title><div id="fixtures"></div><pre id="result">RUNNING</pre>
        <script>window.__navigations=[];window.__testLocation={href:'https://example.com/list',hostname:'example.com',pathname:'/list',assign:url=>window.__navigations.push(url)};
        window.GM_getValue=(_k,f)=>f;window.GM_setValue=()=>{};window.GM_registerMenuCommand=()=>{};window.GM_openInTab=()=>{};
        window.GM_addStyle=css=>{const s=document.createElement('style');s.textContent=css;document.head.append(s)};</script>
        <script src="/userscript.js"></script><script src="/browser-tests.js"></script>`;
    const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', req.url === '/' ? 'text/html; charset=utf-8' : 'application/javascript; charset=utf-8');
        res.end(req.url === '/userscript.js' ? instrumented : req.url === '/browser-tests.js' ? browserTests : html);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    if (process.argv.includes('--serve')) {
        console.log(`Preview: http://127.0.0.1:${server.address().port}/`);
        return;
    }
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-pagination-test-'));
    try {
        const output = await new Promise((resolve, reject) => {
            const child = spawn(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                '--disable-background-networking', `--user-data-dir=${temp}`, '--virtual-time-budget=3000', '--dump-dom',
                `http://127.0.0.1:${server.address().port}/`], {windowsHide: true});
            let stdout = '', stderr = '';
            child.stdout.on('data', (chunk) => stdout += chunk);
            child.stderr.on('data', (chunk) => stderr += chunk);
            const timer = setTimeout(() => {child.kill(); reject(new Error('Browser test timed out'));}, 45000);
            child.on('error', (error) => {clearTimeout(timer); reject(error)});
            child.on('close', (code) => {
                clearTimeout(timer);
                if (code) reject(new Error(stderr.slice(-2000)));
                else resolve(stdout);
            });
        });
        const result = output.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];
        assert.ok(result?.startsWith('PASS:'), result || output.slice(-1500));
        console.log(result);
    } finally {
        server.close();
    }
}
browserTests().catch((error) => {console.error(error); process.exitCode = 1});
