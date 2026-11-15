/** Read-only checks against a deployed site. Never uses database service credentials. */
import { chromium } from '@playwright/test';
import { infrastructureChecks } from './infrastructure-checks.mjs';
import { publicFeedCheck } from '../monitoring/public-feed.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const site = process.env.OPS_SITE_URL;
if (!site || !['https://staging.bjjtournaments.net','https://bjjtournaments.net'].includes(site)) throw new Error('Set an approved OPS_SITE_URL');
const results = [];
const check = async (key, work) => {
 const started = performance.now();
 try { const state = await work(); results.push({key,state:state ?? 'healthy',duration_ms:Math.round(performance.now()-started)}); }
 catch (error) {
  const reason = /^monitor_(http_[0-9]{3}|heartbeat_invalid|heartbeat_stale|mail_failed)$/.test(error?.message) ? error.message : 'check_failed';
  results.push({key,state:'failed',reason,duration_ms:Math.round(performance.now()-started)});
 }
};
const browser = await chromium.launch();
try {
 const context = await browser.newContext({locale:'en-US',timezoneId:'America/Chicago',serviceWorkers:'block'});
 const page = await context.newPage(); page.setDefaultTimeout(20000);
 let eventPath, title;
 await check('usable_rows', async () => {
  const response = await page.goto(site,{waitUntil:'domcontentloaded'});
  if (!response?.ok()) throw new Error();
  const row = page.locator('.ds-event a[href^="/tournament/"]').first();
  await row.waitFor({state:'visible'});
  eventPath = await row.getAttribute('href'); title = await row.innerText();
  if (!eventPath || !title.trim()) throw new Error();
 });
 await check('search', async () => {
  if (!title) throw new Error();
  await page.getByRole('searchbox',{name:'Search',exact:true}).fill(title);
  await page.getByRole('link',{name:title,exact:true}).first().waitFor({state:'visible'});
  await page.waitForURL(url=>url.searchParams.get('q')===title);
 });
 await check('upcoming_event',async()=>{
  if (!eventPath) throw new Error();
  const response=await page.goto(new URL(eventPath,site).href);
  if (!response?.ok()) throw new Error();
  await page.getByRole('heading',{level:1}).filter({hasText:title}).waitFor({state:'visible'});
 });
 for (const [key,selector,directory] of [['organizer','main a[href^="/organizer/"]','/organizer'],['location','main a[href^="/tournaments/"]:not([href*="/month"])','/tournaments']]) {
  await check(key,async()=>{
   await page.goto(new URL(directory,site).href);
   const href=await page.locator(selector).first().getAttribute('href');
   if (!href) throw new Error();
   const response=await page.goto(new URL(href,site).href);
   if (!response?.ok()) throw new Error();
   await page.getByRole('heading',{level:1}).waitFor({state:'visible'});
  });
 }
 const past=process.env.OPS_PAST_EVENT_PATH;
 if (!past || !/^\/tournament\/\d+\/?$/.test(past)) results.push({key:'past_event',state:'unknown'});
 else await check('past_event',async()=>{
  const response=await page.goto(new URL(past,site).href);
  if (!response?.ok()) throw new Error();
  await page.getByRole('heading',{level:1}).waitFor({state:'visible'});
  await page.getByText(/event over|event has passed/i).first().waitFor({state:'visible'});
 });
 await check('feed',async()=>{
  const response=await context.request.get(`${site}/feed/events.ics`);
  return publicFeedCheck(response.status(), response.headers()['content-type'], await response.text()).state;
 });
 await check('real_404',async()=>{
  const response=await context.request.get(`${site}/tournament/9007199254740991`);
  if(response.status()!==404) throw new Error();
 });
 if(site==='https://bjjtournaments.net') await check('redirect',async()=>{
  const response=await context.request.get('https://www.bjjtournaments.net/',{maxRedirects:0});
  if(response.status()!==301 || response.headers().location!==`${site}/`) throw new Error();
 });
 const monitor=process.env.OPS_MONITOR_URL, token=process.env.OPS_MONITOR_READ_TOKEN;
 if(!monitor || !token) results.push({key:'monitor',state:'unknown'});
 else await check('monitor',async()=>{
  const response=await fetch(monitor,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error(`monitor_http_${response.status}`);
  const status=await response.json(), age=Date.now()-Date.parse(status.lastCheck);
  if(!Number.isFinite(age) || age< -60000) throw new Error('monitor_heartbeat_invalid');
  if(age>10*60000) throw new Error('monitor_heartbeat_stale');
  if(status.mailError) throw new Error('monitor_mail_failed');
 });
} finally { await browser.close(); }
results.push(...await infrastructureChecks(site));
const report={checked_at:new Date().toISOString(),site,checks:results};
await mkdir('test-results/operations',{recursive:true});
await writeFile('test-results/operations/journeys.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if (process.env.OPS_MONITOR_URL && process.env.OPS_EXTERNAL_WRITE_TOKEN) {
 try {
  const response=await fetch(new URL('/external',process.env.OPS_MONITOR_URL),{method:'POST',headers:{Authorization:`Bearer ${process.env.OPS_EXTERNAL_WRITE_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(report),signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error();
 } catch { console.error('External evidence delivery failed'); process.exitCode=1; }
} else { console.error('External evidence delivery not configured'); process.exitCode=1; }
if(results.some(r=>r.state!=='healthy')) process.exitCode=1;
