// Executes the indicator's actual Pine logic with deterministic market-data inputs.
// External price requests and exchange/confirmation flags are controlled: PineTS
// is not a substitute for TradingView's data feeds. This does not certify TV
// compilation or live feed synchronization. The unmodified source is parsed too.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PineTS, Indicator } = require('pinets');
const source = fs.readFileSync(path.join(__dirname, '../spx_psych_levels.pine'), 'utf8');
const ms = value => Date.parse(value);
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-6, `${a} != ${b}`);
const row = (date, close, spx, extra={}) => ({date, close, spx, ...extra});
const parentize = (rows,timeframe,spy=false) => {
  const duration=Number(timeframe)*60000, groups=new Map();
  for(const r of rows) {
    const offset=r.date.slice(-6), day=r.date.slice(0,10);
    let anchor=ms(`${day}T${spy?'09:30':'18:00'}:00${offset}`);
    if(!spy && ms(r.date)<anchor) anchor-=86400000;
    const start=anchor+Math.floor((ms(r.date)-anchor)/duration)*duration;
    if(!groups.has(start)) groups.set(start,[]);
    groups.get(start).push(r);
  }
  return [...groups].sort(([a],[b])=>a-b).map(([start,children])=>{
    const prices=children.map(r=>r.close), highs=children.map(r=>r.high??r.close), lows=children.map(r=>r.low??r.close);
    const spx=[...children].reverse().find(r=>r.spx!=null)?.spx;
    return row(new Date(start).toISOString(),prices.at(-1),spx,{
      end:start+duration,open:children[0].open??prices[0],high:Math.max(...highs),low:Math.min(...lows),
      sessionMarket:children.some(r=>r.sessionMarket!==false),
      sessionLastbarRegular:children.some(r=>r.sessionLastbarRegular===true),
      barConfirmed:children.every(r=>r.barConfirmed!==false),
    });
  });
};
const pineSeries = values => values.map((x,i)=>`bar_index == ${i} ? ${x == null ? 'float(na)' : x} : `).join('')+'float(na)';
const pineBoolSeries = (values, fallback) => values.flatMap((x,i)=>
  x == null || Boolean(x) === fallback ? [] : [`bar_index == ${i} ? ${Boolean(x)} : `]
).join('')+String(fallback);
const pineBoolArrays = groups => groups.map((values,i)=>
  `bar_index == ${i} ? ${values.length?`array.from(${values.map(v=>Boolean(v)).join(',')})`:'array.new_bool()'} : `
).join('')+'array.new_bool()';
const pineArrays = (groups,type) => groups.map((values,i)=>
  `bar_index == ${i} ? ${values.length?`array.from(${values.map(v=>v==null?'float(na)':v).join(',')})`:`array.new_${type}()`} : `
).join('')+`array.new_${type}()`;
const probes = {
  start:'session_start_time', end:'grid_session_end', key:'grid_session_id',
  basis:'observed_basis', sampled:'basis_last_update', active:'display_fair_value',
  pending:'session_basis_pending ? 1 : 0', anchor:'display_basis_time',
  adrCount:'array.size(adr_hist)', adr:'session_adr', rthOpen:'rth_open_today',
  rthCurrent:'rth_is_current ? 1 : 0',
  processed:'last_processed_sample_time',
  sampleCount:'array.size(sample_times)', quoteCount:'array.size(quote_times)',
  mapped:'spx_to_chart(7700, display_fair_value)', model:'raw_model_fv',
  rate:'display_interest_rate', estimated:'session_rate_estimated ? 1 : 0', fredCalls:'probe_fred_calls', tsyCalls:'probe_tsy_calls',
  n100:'n100_drawn', n50:'n50_drawn', n25:'n25_drawn',
  cap:'na(adr_up_ln) ? na : line.get_y1(adr_up_ln)',
  capDown:'na(adr_dn_ln) ? na : line.get_y1(adr_dn_ln)',
  capStart:'na(adr_up_ln) ? na : line.get_x1(adr_up_ln)',
  capEnd:'na(adr_up_ln) ? na : line.get_x2(adr_up_ln)',
  capAnchor:'adr_anchor_time',
  capCompact:'na(adr_up_lb) or na(adr_dn_lb) ? 0 : (label.get_text(adr_up_lb) == "ADR+ " + str.tostring(line.get_y1(adr_up_ln), format.mintick) and label.get_text(adr_dn_lb) == "ADR- " + str.tostring(line.get_y1(adr_dn_ln), format.mintick) ? 1 : 0)',
  capSessionText:'na(adr_up_lb) ? 0 : (str.contains(label.get_text(adr_up_lb), "RTH") or str.contains(label.get_text(adr_up_lb), "last cash") ? 1 : 0)',
  capClaimFree:'na(adr_up_lb) or na(adr_dn_lb) ? 0 : (not str.contains(label.get_text(adr_up_lb), "%") and not str.contains(label.get_text(adr_up_lb), "cont") and not str.contains(label.get_text(adr_up_lb), "reached") and not str.contains(label.get_text(adr_dn_lb), "%") and not str.contains(label.get_text(adr_dn_lb), "cont") and not str.contains(label.get_text(adr_dn_lb), "reached") ? 1 : 0)',
  zone:'probe_zone_width(zones_100)',
  histLines:'array.size(hist_lines)', histZones:'array.size(hist_zones)', histSessions:'array.size(hist_line_counts)',
  histLeak:'probe_hist_leak()', histBad:'probe_hist_bad()',
  gridLines:'array.size(lines_100) + array.size(lines_50) + array.size(lines_25)',
  zones:'array.size(zones_100) + array.size(zones_50) + array.size(zones_25)',
  caps:'(na(adr_up_ln) ? 0 : 1) + (na(adr_dn_ln) ? 0 : 1)',
  labels:'(na(adr_up_lb) ? 0 : 1) + (na(adr_dn_lb) ? 0 : 1)',
  infoTable:'na(info_table) ? 0 : 1', infoRows:'info_rows_drawn',
  count25:'array.size(spx_25)', zones25:'array.size(zones_25)',
  low25:'probe_tier_extreme(spx_25, false)', high25:'probe_tier_extreme(spx_25, true)',
  low50:'probe_tier_extreme(spx_50, false)', high50:'probe_tier_extreme(spx_50, true)',
  low100:'probe_tier_extreme(spx_100, false)', high100:'probe_tier_extreme(spx_100, true)', reach100:'reach_100_drawn',
  has7675:'array.includes(spx_25, 7675) ? 1 : 0', target7675:'probe_25_y(7675)',
  spacing25:'probe_25_spacing()', zoneWidth25:'probe_zone_width(zones_25)',
};
async function run(rows, {spy=false, symbol=spy?'SPY':'ES1!', inputs={}, timeframe='5', rates={}, rejectFred=false, rejectRates=false, lowerRows=null, lowerQuotes=null}={}) {
  const isSpy = symbol === 'SPY';
  const barMs = timeframe === 'D' ? 86400000 : timeframe.endsWith('S') ? Number(timeframe.slice(0,-1)) * 1000 : Number(timeframe) * 60000;
  const normalizedLowerQuotes = lowerQuotes ?? (lowerRows || []).flatMap(r => {
    const q=r.quote||{}, price=q.price??r.spx;
    return price==null ? [] : [{date:new Date(q.time??ms(r.date)).toISOString(),end:q.end,close:price}];
  });
  let held = {price:null,time:null,end:null};
  const quotes = rows.map(r => {
    if (r.spx != null) held = {price:r.spx,time:ms(r.date),end:ms(r.date)+barMs};
    return {...held, ...(r.quote || {})};
  });
  // Fixtures explicitly include forward-filled old SPX timestamps on holidays.
  let code = source.replace(/^\[spx_live, spx_bar_time, spx_bar_close_time\] = request\.security[^\r\n]*/m,
    `spx_live = ${pineSeries(quotes.map(q=>q.price))}\nspx_bar_time = ${pineSeries(quotes.map(q=>q.time))}\nspx_bar_close_time = ${pineSeries(quotes.map(q=>q.end))}`);
  // The fixtures are historical and therefore fully closed. Do not let the host
  // wall clock make a future-dated regression silently drop its last intrabars.
  code = code.replaceAll('timenow', '4102444800000');
  // PineTS does not model TradingView's exchange-calendar session flags: ismarket
  // is always true and islastbar_regular follows calendar-day/fixture boundaries.
  // It also cannot reproduce realtime confirmation updates. Always replace those
  // native values with deterministic TV-feed semantics: regular/confirmed by
  // default, never last-regular unless the fixture explicitly says so. These cases
  // validate our Pine response to the flags, not PineTS's provider parity.
  // PineTS 0.9.33 cannot reliably execute this conditional lower-TF tuple with
  // session flags. Keep the real calls for syntax/request-guard coverage only, then
  // overwrite every result with deterministic arrays for state-machine tests.
  if (lowerRows) {
    const lowerRequest = /^.*request\.security_lower_tf\(syminfo\.tickerid,[^\r\n]*$/m;
    const lowerQuoteRequest = /^.*request\.security_lower_tf\("SP:SPX",[^\r\n]*$/m;
    assert.match(code, lowerRequest, 'chart lower-timeframe request must exist');
    assert.match(code, lowerQuoteRequest, 'SPX lower-timeframe request must exist');
    const grouped=rows.map(parent=>lowerRows.filter(r=>ms(r.date)>=ms(parent.date)&&ms(r.date)+300000<=(parent.end??ms(parent.date)+barMs)));
    const groupedQuotes=rows.map(parent=>normalizedLowerQuotes.filter(r=>ms(r.date)>=ms(parent.date)&&(r.end??ms(r.date)+300000)<=(parent.end??ms(parent.date)+barMs)));
    code = code.replace(lowerRequest, line=>line+'\n'+[
      `    ltf_times := ${pineArrays(grouped.map(g=>g.map(r=>ms(r.date))),'int')}`,
      `    ltf_ends := ${pineArrays(grouped.map(g=>g.map(r=>r.end??ms(r.date)+300000)),'int')}`,
      `    ltf_opens := ${pineArrays(grouped.map(g=>g.map(r=>r.open??r.close)),'float')}`,
      `    ltf_highs := ${pineArrays(grouped.map(g=>g.map(r=>r.high??r.close+(isSpy?.2:2))),'float')}`,
      `    ltf_lows := ${pineArrays(grouped.map(g=>g.map(r=>r.low??r.close-(isSpy?.2:2))),'float')}`,
      `    ltf_closes := ${pineArrays(grouped.map(g=>g.map(r=>r.close)),'float')}`,
      `    ltf_market := ${pineBoolArrays(grouped.map(g=>g.map(r=>r.sessionMarket??true)))}`,
      `    ltf_last_regular := ${pineBoolArrays(grouped.map(g=>g.map(r=>r.sessionLastbarRegular??false)))}`,
    ].join('\n'));
    code = code.replace(lowerQuoteRequest, line=>line+'\n'+[
      `    ltf_spx_times := ${pineArrays(groupedQuotes.map(g=>g.map(r=>ms(r.date))),'int')}`,
      `    ltf_spx_ends := ${pineArrays(groupedQuotes.map(g=>g.map(r=>r.end??ms(r.date)+300000)),'int')}`,
      `    ltf_spx_closes := ${pineArrays(groupedQuotes.map(g=>g.map(r=>r.close)),'float')}`,
    ].join('\n'));
  }
  for (const [field,native,fallback] of [
    ['sessionMarket','session.ismarket',true],
    ['sessionLastbarRegular','session.islastbar_regular',false],
    ['barConfirmed','barstate.isconfirmed',true],
  ]) {
    assert.ok(code.includes(native), `${native} must exist for fixture override`);
    code = code.replaceAll(native, `(${pineBoolSeries(rows.map(r=>r[field]),fallback)})`);
  }
  code = code.replace('// === DATA ===', 'var int probe_fred_calls = 0\nvar int probe_tsy_calls = 0\n// === DATA ===');
  const constants = {spx_daily_close:7700, chart_atr14:isSpy?8:80, vix_val:20, vix_fallback:20};
  for (const [name,value] of Object.entries(constants)) {
    const tupleNames = name === 'spx_daily_close' ? ['spx_daily_current','spx_daily_end','spx_daily_previous'] :
      name === 'chart_atr14' ? ['chart_atr_current','chart_atr_end','chart_atr_previous'] :
      name === 'vix_val' ? ['vix_current','vix_end','vix_previous'] :
      ['vix_fallback_current','vix_fallback_end','vix_fallback_previous'];
    const tuple = new RegExp(`^\\[${tupleNames.join(', *')}\\] = request\\.security[^\\r\\n]*`, 'm');
    const scalar = new RegExp(`^${name} = request\\.security[^\\r\\n]*`, 'm');
    assert.ok(tuple.test(code) || scalar.test(code), `market input ${name} must exist`);
    code = tuple.test(code) ? code.replace(tuple,
      `${tupleNames[0]} = ${value}.0\n${tupleNames[1]} = 0\n${tupleNames[2]} = ${value}.0`) :
      code.replace(scalar, `${name} = ${value}.0`);
  }
  // Every optional rate request (FRED or free Treasury) is replaced by a counted,
  // fixture-controlled value. FRED keys: r1m/r3m/r6m/r1y. Treasury keys: tsy_r1m,
  // us03m, irx_raw, irx_alt, tsy_r6m, tsy_r1y (IRX defaults absent, so 3M = US03M).
  const rateRequest = /^( +)(\w+) := request\.security\("(FRED|TVC|CBOE):[^\r\n]*/gm;
  const seen = [];
  code = code.replace(rateRequest, (_,indent,name,feed)=>{
    const fred = feed === 'FRED';
    const key = fred || !['r1m','r6m','r1y'].includes(name) ? name : `tsy_${name}`;
    seen.push(key);
    const value = Object.hasOwn(rates,key) ? rates[key] : (key.startsWith('irx') ? null : 4);
    const reject = rejectRates || (fred && rejectFred);
    return `${indent}${fred?'probe_fred_calls':'probe_tsy_calls'} += 1\n${reject?indent+`runtime.error("Unexpected ${feed} rate request in disabled path")\n`:''}${indent}${name} := ${value==null?'float(na)':Number(value).toFixed(6)}`;
  });
  for (const key of ['r1m','r3m','r6m','r1y','tsy_r1m','us03m','irx_raw','irx_alt','tsy_r6m','tsy_r1y'])
    assert.ok(seen.includes(key), `guarded rate input ${key} must exist`);
  assert.ok(!/= request\.security\(/.test(code), 'All higher-timeframe external inputs must be controlled');
  code += '\nprobe_zone_width(zones) =>\n    float width = na\n    if array.size(zones) > 0\n        width := box.get_top(array.get(zones, 0)) - box.get_bottom(array.get(zones, 0))\n    width\n';
  code += '\nprobe_hist_leak() =>\n    int n = 0\n    for ln in hist_lines\n        if not na(session_start_time) and line.get_x2(ln) > session_start_time\n            n += 1\n    n\n';
  code += '\nprobe_hist_bad() =>\n    int n = 0\n    for ln in hist_lines\n        if line.get_x1(ln) >= line.get_x2(ln)\n            n += 1\n    n\n';
  code += '\nprobe_tier_extreme(values, top) =>\n    float value = na\n    if array.size(values) > 0\n        value := top ? array.max(values) : array.min(values)\n    value\n';
  code += '\nprobe_25_y(target) =>\n    float value = na\n    idx = array.indexof(spx_25, target)\n    if idx >= 0\n        value := line.get_y1(array.get(lines_25, idx))\n    value\n';
  code += '\nprobe_25_spacing() =>\n    bool regular = true\n    if array.size(spx_25) > 0\n        for i = 0 to array.size(spx_25) - 1\n            if is_mult(array.get(spx_25, i), 50)\n                regular := false\n            if i > 0\n                if array.get(spx_25, i) - array.get(spx_25, i - 1) != 50\n                    regular := false\n    regular ? 1 : 0\n';
  code += '\n'+Object.entries(probes).map(([name,expr])=>`plot(${expr}, title="probe_${name}")`).join('\n');
  const toBars = (fixtureRows, duration) => fixtureRows.map(r => ({openTime:ms(r.date),closeTime:r.end??ms(r.date)+duration,
    open:r.open??r.close, high:r.high??r.close+(isSpy?.2:2), low:r.low??r.close-(isSpy?.2:2),close:r.close,volume:1000}));
  const bars = toBars(rows,barMs);
  const lowerBars = lowerRows ? toBars(lowerRows,300000) : [];
  const lowerQuoteBars = toBars(normalizedLowerQuotes,300000);
  const stock = ['SPY','QQQ','AAPL'].includes(symbol);
  const index = symbol === 'SPX';
  const root = symbol.startsWith('MES') ? 'MES' : symbol.startsWith('ES') ? 'ES' :
    symbol.startsWith('NQ') ? 'NQ' : symbol.replace(/[^A-Z].*$/,'');
  const lowerRequests=[];
  const provider = {
    configure(){}, async getMarketData(tickerId,requestedTimeframe,limit,start,end){
      if(requestedTimeframe!=='5' || !lowerRows) return bars;
      const requested=tickerId==='SP:SPX'||tickerId==='SPX'?lowerQuoteBars:lowerBars;
      const filtered=requested.filter(bar=>(start==null||bar.openTime>=start)&&(end==null||bar.closeTime<=end));
      lowerRequests.push({tickerId,start,end,count:filtered.length});
      return filtered;
    },
    async getSymbolInfo(tickerId){
      const requestedIndex=tickerId==='SP:SPX'||tickerId==='SPX';
      return {ticker:requestedIndex?'SPX':symbol,tickerid:tickerId,main_tickerid:tickerId,
        root:requestedIndex?'SPX':root,
        timezone:requestedIndex||stock||index?'America/New_York':'America/Chicago', session:'24x7',
        type:requestedIndex||index?'index':stock?'stock':'futures',mintick:stock?.01:.25,pricescale:100,minmove:1,pointvalue:stock?1:50};
    }
  };
  const result = await new PineTS(provider,symbol,timeframe,bars.length).run(new Indicator(code,inputs));
  return {...Object.fromEntries(Object.keys(probes).map(name=>[name,result.plots[`probe_${name}`].data.map(p=>p.value)])),_lowerRequests:lowerRequests};
}
const holiday = [
  row('2026-09-04T09:30:00-04:00',7710,7700),
  row('2026-09-04T15:55:00-04:00',7710,7700),
  row('2026-09-04T16:00:00-04:00',7711),
  row('2026-09-06T18:00:00-04:00',7715),
  row('2026-09-07T09:30:00-04:00',7730),
  row('2026-09-07T12:55:00-04:00',7735),
  row('2026-09-07T18:00:00-04:00',7734),
  row('2026-09-08T09:30:00-04:00',7722,7715),
  row('2026-09-08T09:35:00-04:00',7724,7715),
  row('2026-09-08T15:55:00-04:00',7724,7715),
  row('2026-09-08T16:00:00-04:00',7724),
  row('2026-09-08T18:00:00-04:00',7723),
  row('2026-09-09T09:30:00-04:00',7723,7715),
];
(async()=>{
  new Indicator(source).prepare();
  console.log('PASS unmodified Pine source parses/transpiles in PineTS');
  assert.match(source,/dynamic_requests=true/);
  assert.match(source,/Version 16\.11\.0/);
  assert.match(source,/indicator\("SPX Psych Levels \+ Fair Value for ES, MES and SPY", shorttitle="SPX Psych Levels"/,"Indicator name carries no version number");
  assert.equal((source.match(/request\.security_lower_tf\(/g)||[]).length,2);
  for(const seconds of [3600,7200,10800,14400]) assert.match(source,new RegExp(`chart_seconds == ${seconds}`));
  const fredRequests=source.split(/\r?\n/).filter(line=>line.includes('request.security("FRED:'));
  assert.equal(fredRequests.length,4);
  for(const request of fredRequests) assert.match(request,/ignore_invalid_symbol=true/,'Every optional FRED request must fail softly for invalid data');
  const rateRequests=source.split(/\r?\n/).filter(line=>/request\.security\("(FRED|TVC|CBOE):(DGS|US0|IRX)/.test(line));
  assert.equal(rateRequests.length,10);
  for(const tenor of ['US01MY','US03MY','US06MY','US01Y']) assert.ok(source.includes(`"TVC:${tenor}"`),`${tenor} yield symbol`);
  assert.doesNotMatch(source,/"TVC:US0[136]M"/,'TVC:US01M/03M/06M are bill prices, not yields');
  for(const request of rateRequests) assert.match(request,/ignore_invalid_symbol=true/,'Every optional rate request must fail softly for invalid data');
  assert.match(source,/rate_source = input\.string\("Treasury \(free\)",/,'Free Treasury rates are the default model source; FRED is never a default dependency');
  assert.match(source,/if is_valid and not is_spy and fv_mode != "Observed" and rate_source != "Fixed backup"/,'Rate requests stay behind the model-mode guard');
  assert.doesNotMatch(source,/cont 71-81|reached ~16/i,'ADR captions must not retain empirical continuation/reach claims');
  assert.match(source,/is_valid = timeframe_supported and \(is_continuous or is_current_contract or is_spy\)/,'Only ES, MES, and SPY may render');
  const a=await run(holiday,{inputs:{'Show Margin of Error Zones':true}});
  assert.equal(a.start[6],ms(holiday[6].date)); // Monday reopen, same CME trade date.
  assert.equal(a.end[6],ms('2026-09-08T18:00:00-04:00'));
  near(a.basis[4],10); near(a.basis[5],10);
  assert.equal(a.sampled[5],ms(holiday[1].date));
  assert.equal(a.pending[6],1); assert.equal(a.pending[7],0);
  near(a.active[7],7); near(a.active[8],7); near(a.basis[8],7+2/3);
  assert.equal(a.start[7],ms(holiday[7].date)); assert.equal(a.start[8],a.start[7]);
  assert.equal(a.anchor[8],ms(holiday[7].date));
  assert.equal(a.adrCount[2],1); assert.equal(a.adrCount[6],1); assert.equal(a.adrCount[10],2);
  assert.equal(a.start[12],ms(holiday[11].date)); // ordinary overnight anchor stays held.
  near(a.mapped[7],7707); near(a.zone[7],10);
  assert.ok(a.gridLines[7]>0); assert.ok(a.zones[7]>0); assert.equal(a.infoTable[7],1);
  console.log('PASS holiday reopen, no phantom cash basis/ADR, one-time recovery, ordinary anchor hold');
  const live=await run(holiday,{inputs:{'Level Tracking':'Live Basis','Basis Smoothing (bars)':1}});
  near(live.active[8],9); assert.equal(live.anchor[8],ms(holiday[8].date));
  assert.equal(live.start[7],ms(holiday[6].date)); // live recovery retargets, no forced recenter.
  const model=await run(holiday,{inputs:{'Fair Value Mode':'Theoretical'}});
  assert.equal(model.pending[6],0); assert.equal(model.start[7],ms(holiday[6].date));
  const blended=await run(holiday,{inputs:{'Fair Value Mode':'Blended'}});
  near(blended.active[7],blended.model[7]+.5*Math.max(-6,Math.min(6,7-blended.model[7])));
  console.log('PASS live tracking and futures Observed/Blended/Theoretical behavior');
  // Info table rows are picked individually. Default: only Fair value (plus a Check
  // row if something is wrong). All rows on: 7. None ticked: no table at all.
  const allRows={'Fair Value / Basis':true,'SPX Equivalent':true,'Nearest Levels':true,'Nearest 100s':true,'Day Range / ADR':true,'ADR+ / ADR- Prices':true,'Contract':true};
  const noRows=Object.fromEntries(Object.keys(allRows).map(k=>[k,false]));
  for(const [inputs,expected,rows] of [[{},1,1],[allRows,1,7],[noRows,0,null],[{...noRows,'Contract':true,'Table Position':'Top Left','Table Text Size':'Tiny'},1,1]]) {
    for(const spyChart of [false,true]) {
      const t=await run(spyChart?holiday.map(r=>({...r,close:r.spx!=null?r.spx/10-1.6:r.close/10-2.6})):holiday,{spy:spyChart,inputs:{...inputs,'Fair Value Mode':'Observed'}});
      assert.equal(t.infoTable.at(-1),expected,`${JSON.stringify(inputs)}/${spyChart?'SPY':'ES'} info table`);
      if(rows!=null) assert.ok(t.infoRows.at(-1)===rows || t.infoRows.at(-1)===rows+1,`rows ${t.infoRows.at(-1)} vs ${rows} (+1 Check)`);
      assert.ok(t.gridLines.at(-1)>0);
    }
  }
  console.log('PASS info-table rows are user-selectable; default shows fair value only; none hides the table');
  const rateRows=[row('2026-09-22T09:30:00-04:00',7710,7700),row('2026-09-22T09:35:00-04:00',7711,7701)];
  const noRates={r1m:null,r3m:null,r6m:null,r1y:null};
  const obsNoFeed=await run(rateRows,{rejectRates:true});
  near(obsNoFeed.active.at(-1),10); assert.equal(obsNoFeed.fredCalls.at(-1),0);
  assert.equal(obsNoFeed.estimated.at(-1),1); assert.ok(obsNoFeed.gridLines.at(-1)>0);
  const noSpx=await run(rateRows.map(r=>({...r,spx:undefined})),{rejectRates:true});
  assert.equal(noSpx.fredCalls.at(-1),0); assert.equal(noSpx.estimated.at(-1),1);
  assert.ok(Number.isFinite(noSpx.active.at(-1))); assert.ok(Number.isFinite(noSpx.model.at(-1)));
  assert.ok(noSpx.gridLines.at(-1)>0); assert.equal(noSpx.pending.at(-1),1);
  for(const source of ['FRED','Treasury (free)']) {
    const obsOptIn=await run(rateRows,{rejectRates:true,inputs:{'Model Rate Source':source}});
    assert.equal(obsOptIn.fredCalls.at(-1),0); assert.equal(obsOptIn.tsyCalls.at(-1),0);
    near(obsOptIn.active.at(-1),obsNoFeed.active.at(-1));
  }
  for(const mode of ['Theoretical','Blended']) {
    // Default model source is the free Treasury curve: no FRED, live (non-est) rate.
    const defaultModel=await run(rateRows,{inputs:{'Fair Value Mode':mode},rejectFred:true});
    assert.equal(defaultModel.fredCalls.at(-1),0); assert.equal(defaultModel.tsyCalls.at(-1),6*rateRows.length);
    assert.equal(defaultModel.estimated.at(-1),0);
    assert.ok(Number.isFinite(defaultModel.active.at(-1))); assert.ok(defaultModel.gridLines.at(-1)>0);
    const tsyInputs={'Fair Value Mode':mode};
    const tsyGone=await run(rateRows,{inputs:tsyInputs,rates:{tsy_r1m:null,us03m:null,tsy_r6m:null,tsy_r1y:null}});
    assert.equal(tsyGone.estimated.at(-1),1); assert.ok(Number.isFinite(tsyGone.model.at(-1)));
    // 3M proxy: 0.6 x IRX (discount -> bond-equivalent) + 0.4 x US03M.
    // Sept 22 prices the Dec contract on the 1M-3M leg: rate = 4 + w*(r3m-4) + 0.45.
    const bey=pct=>100*365*(pct/100)/(360-91*(pct/100));
    const us3Only=await run(rateRows,{inputs:tsyInputs,rates:{us03m:4.18}});
    const w=(us3Only.rate.at(-1)-4.45)/0.18;
    assert.ok(w>0&&w<1,`3M interpolation weight ${w}`);
    const expected3m=0.6*bey(4.07)+0.4*4.18;
    for(const irx of [{irx_raw:40.7},{irx_raw:4.07},{irx_alt:40.7}]) {
      const blend=await run(rateRows,{inputs:tsyInputs,rates:{us03m:4.18,...irx}});
      near(blend.rate.at(-1),4.45+w*(expected3m-4)); assert.equal(blend.estimated.at(-1),0);
    }
    const irxOnly=await run(rateRows,{inputs:tsyInputs,rates:{us03m:null,irx_raw:40.7}});
    near(irxOnly.rate.at(-1),4.45+w*(bey(4.07)-4)); assert.equal(irxOnly.estimated.at(-1),0);
    const no3m=await run(rateRows,{inputs:tsyInputs,rates:{us03m:null}});
    assert.equal(no3m.estimated.at(-1),1);
    // Browser test 2026-09-26: TVC:US01M/03M/06M return bill prices (~99), not yields.
    // Price-like values must be rejected, never clamped into a 5.5% "rate".
    const prices=await run(rateRows,{inputs:tsyInputs,rates:{tsy_r1m:99.67,us03m:98.98,tsy_r6m:97.89,tsy_r1y:99.1}});
    assert.equal(prices.estimated.at(-1),1); near(prices.model.at(-1),tsyGone.model.at(-1));
    const inputs={'Fair Value Mode':mode,'Model Rate Source':'FRED'};
    const liveRates=await run(rateRows,{inputs});
    assert.ok(liveRates.fredCalls.at(-1)>0); assert.equal(liveRates.tsyCalls.at(-1),0); assert.equal(liveRates.estimated.at(-1),0);
    const absent=await run(rateRows,{inputs,rates:noRates});
    assert.ok(Number.isFinite(absent.model.at(-1))); assert.ok(Number.isFinite(absent.active.at(-1)));
    assert.equal(absent.estimated.at(-1),1); assert.ok(absent.gridLines.at(-1)>0);
    const bypass=await run(rateRows,{inputs:{...inputs,'Model Rate Source':'Fixed backup'},rejectRates:true});
    assert.equal(bypass.fredCalls.at(-1),0); assert.equal(bypass.tsyCalls.at(-1),0); near(bypass.model.at(-1),absent.model.at(-1));
    near(bypass.active.at(-1),absent.active.at(-1)); assert.equal(bypass.estimated.at(-1),1);
    near(tsyGone.model.at(-1),bypass.model.at(-1));
    for(const name of Object.keys(noRates)) {
      const partial=await run(rateRows,{inputs,rates:{[name]:null}});
      assert.ok(Number.isFinite(partial.rate.at(-1))); assert.ok(Number.isFinite(partial.model.at(-1)));
      // September 22's December contract uses the 1M/3M interpolation interval.
      assert.equal(partial.estimated.at(-1),['r1m','r3m'].includes(name)?1:0);
    }
    for(const [rawRate,boundedRate] of [[0,4.5],[20,5.5]]) {
      const bounded=await run(rateRows,{inputs,rates:{r1m:rawRate,r3m:rawRate,r6m:rawRate,r1y:rawRate}});
      near(bounded.rate.at(-1),boundedRate); assert.equal(bounded.estimated.at(-1),1);
    }
  }
  const spyNoFeed=await run(rateRows.map(r=>({...r,close:r.spx/10-1.6})),{spy:true,rejectRates:true,inputs:{'Fair Value Mode':'Theoretical','Model Rate Source':'FRED'}});
  assert.equal(spyNoFeed.fredCalls.at(-1),0); assert.equal(spyNoFeed.tsyCalls.at(-1),0); assert.ok(Number.isNaN(spyNoFeed.rate.at(-1)));
  near(spyNoFeed.active.at(-1),-1.6);
  console.log('PASS no rate requests in Observed/SPY/Fixed paths; free Treasury default and IRX/US03M 3M proxy; missing/partial rates use labelled estimates');
  const spyRows=holiday.map(r=>({...r,close:r.spx!=null?r.spx/10-1.6:r.close/10-2.6}));
  const spy=await run(spyRows,{spy:true,inputs:{'Manual Adjustment (SPX pts)':2,'Show Margin of Error Zones':true}});
  near(spy.active[7],-1.4); near(spy.mapped[7],768.6); near(spy.zone[7],1);
  console.log('PASS SPY observed-basis mapping, manual-adjustment and zone units');
  const delayed=holiday.map(r=>({...r}));
  delayed[7].spx=undefined; // first fresh quote is the following 5-minute bar.
  const late=await run(delayed);
  assert.equal(late.pending[7],1); assert.equal(late.start[8],ms(holiday[8].date)); near(late.active[8],9);
  const wrongEnd=holiday.map(r=>({...r}));
  wrongEnd[7].quote={end:ms(wrongEnd[7].date)+600000};
  const rejected=await run(wrongEnd);
  assert.equal(rejected.pending[7],1); assert.equal(rejected.pending[8],0);
  console.log('PASS missing/delayed or mismatched source intervals cannot refresh the anchor');
  const rth=[];
  for(let d=ms('2026-08-17T00:00:00Z');d<=ms('2026-09-09T00:00:00Z');d+=86400000){
    const date=new Date(d).toISOString().slice(0,10), dow=new Date(d).getUTCDay();
    if(dow===0||dow===6||date==='2026-09-07')continue;
    rth.push(row(date+'T09:30:00-04:00',769,7700,{high:769.2,low:768.8}));
    rth.push(row(date+'T15:55:00-04:00',773,7740,{high:773.2,low:772.8}));
  }
  const rConfirmed=await run(rth,{spy:true});
  assert.equal(rConfirmed.adrCount.at(-1),rth.length/2-1); near(rConfirmed.adr.at(-1),4.4);
  assert.equal(rConfirmed.rthOpen.at(-1),769);
  assert.equal(rConfirmed.caps.at(-1),0,'A confirmed SPY 15:55-16:00 bar must clear its caps');
  const rUnconfirmedRows=rth.map((r,i)=>i===rth.length-1?{...r,barConfirmed:false}:r);
  const rUnconfirmed=await run(rUnconfirmedRows,{spy:true});
  near(rUnconfirmed.cap.at(-1),773.4);
  assert.equal(rUnconfirmed.caps.at(-1),2,'The same unconfirmed SPY closing bar must keep its caps');
  console.log('PASS SPY RTH-only final-bar confirmation controls closing cleanup');
  const adrWarm=[];
  for(let d=ms('2026-08-28T00:00:00Z');d<ms('2026-09-21T00:00:00Z');d+=86400000){
    const date=new Date(d).toISOString().slice(0,10), dow=new Date(d).getUTCDay();
    if(dow===0||dow===6||date==='2026-09-07')continue;
    adrWarm.push(row(date+'T09:30:00-04:00',7760.5,7742,{high:7785.125,low:7735.875}));
    adrWarm.push(row(date+'T15:45:00-04:00',7760.5,7742));
    adrWarm.push(row(date+'T16:00:00-04:00',7760.5));
  }
  const adrToday=[
    row('2026-09-21T09:30:00-04:00',7760.5,7742),
    row('2026-09-21T15:45:00-04:00',7840,7821.5,{high:7842,low:7760}),
    row('2026-09-21T16:00:00-04:00',7840),
    row('2026-09-21T18:00:00-04:00',7834),
    row('2026-09-22T04:00:00-04:00',7836),
    row('2026-09-22T09:15:00-04:00',7838.5),
    row('2026-09-22T09:30:00-04:00',7840,7821.5),
    row('2026-09-22T09:45:00-04:00',7890,7871.5,{high:7900,low:7830}),
    row('2026-09-22T15:45:00-04:00',7840,7821.5),
    row('2026-09-22T16:00:00-04:00',7840),
    row('2026-09-22T18:00:00-04:00',7840),
  ];
  const adrRows=[...adrWarm,...adrToday], ai=adrWarm.length;
  const fresh=await run(adrRows,{timeframe:'15'});
  near(fresh.cap[ai],7809.75); near(fresh.capDown[ai],7711.25);
  const oldCap=fresh.cap[ai], oldAnchor=ms(adrToday[0].date);
  for(const offset of [2,3,4,5]) {
    assert.equal(fresh.caps[ai+offset],2,'Futures must retain the last valid cash caps');
    assert.equal(fresh.labels[ai+offset],2,'Retained futures lines keep their compact labels');
    near(fresh.cap[ai+offset],oldCap);
    assert.equal(fresh.capAnchor[ai+offset],oldAnchor);
    assert.equal(fresh.capCompact[ai+offset],1);
    assert.equal(fresh.capSessionText[ai+offset],0);
    assert.equal(fresh.capClaimFree[ai+offset],1);
    if(offset>=3) assert.equal(fresh.rthCurrent[ai+offset],0,'Day / ADR must not reuse yesterday\'s range');
  }
  const priorAdr=(13*49.25+83.5)/14; // yesterday is included; today's range is not.
  near(fresh.cap[ai+6],7840+priorAdr); near(fresh.capDown[ai+6],7840-priorAdr);
  near(fresh.cap[ai+7],fresh.cap[ai+6]); near(fresh.cap[ai+8],fresh.cap[ai+6]);
  assert.equal(fresh.capStart[ai+6],ms(adrToday[6].date));
  assert.equal(fresh.capEnd[ai+6],ms('2026-09-22T16:00:00-04:00'));
  assert.equal(fresh.capCompact[ai+6],1);
  assert.equal(fresh.capSessionText[ai+6],0);
  assert.equal(fresh.capClaimFree[ai+6],1);
  assert.equal(fresh.rthCurrent[ai+6],1);
  assert.equal(fresh.adrCount[ai+6],fresh.adrCount[ai]+1);
  near(fresh.cap[ai+10],fresh.cap[ai+6]);
  assert.equal(fresh.capAnchor[ai+10],ms(adrToday[6].date));
  assert.equal(fresh.capCompact[ai+10],1);
  assert.equal(fresh.capSessionText[ai+10],0);
  assert.ok(fresh.capEnd[ai+10]>ms('2026-09-22T16:00:00-04:00'));
  const delayedAdr=adrRows.map(r=>({...r}));
  delayedAdr[ai+6].spx=undefined;
  const freshLate=await run(delayedAdr,{timeframe:'15'});
  near(freshLate.cap[ai+6],oldCap);
  assert.equal(freshLate.capAnchor[ai+6],oldAnchor);
  assert.equal(freshLate.capSessionText[ai+6],0);
  near(freshLate.cap[ai+7],7840+priorAdr); // delayed quote does not change 09:30 open.
  assert.equal(freshLate.capStart[ai+7],ms(adrToday[6].date));
  const missingOpen=await run(adrRows.filter((_,i)=>i!==ai+6),{timeframe:'15'});
  near(missingOpen.cap[ai+6],oldCap);
  assert.equal(missingOpen.capAnchor[ai+6],oldAnchor,'A 09:45 bar must not replace the prior cash anchor');
  assert.equal(missingOpen.capCompact.at(-1),1);
  assert.equal(missingOpen.capSessionText.at(-1),0);
  assert.equal(missingOpen.adrCount.at(-1),fresh.adrCount.at(-1)-1,'Incomplete opening session must not enter ADR history');
  const lateSeconds=await run(adrRows.map((r,i)=>i===ai+6?{...r,date:'2026-09-22T09:30:05-04:00'}:r),{timeframe:'5S'});
  assert.equal(lateSeconds.caps[ai],2,'Seconds charts with the exact opening bar can draw an envelope');
  near(lateSeconds.cap[ai+6],oldCap);
  assert.equal(lateSeconds.capAnchor[ai+6],oldAnchor,'A 09:30:05 bar must not reanchor the envelope');
  const noEvening=await run(adrRows.filter(r=>!['2026-09-21T18:00:00-04:00','2026-09-22T04:00:00-04:00'].includes(r.date)),{timeframe:'15'});
  near(noEvening.cap[ai+3],oldCap);
  assert.equal(noEvening.capAnchor[ai+3],oldAnchor,'A missing 18:00 bar must not expire the last cash anchor');
  assert.equal(noEvening.capAnchor[ai+4],ms(adrToday[6].date));
  const ten=await run(adrRows,{timeframe:'15',inputs:{'Volatility Source':'ADR-10'}});
  near(ten.cap[ai+6],7840+(9*49.25+83.5)/10);
  const noCash=await run(adrRows.map(r=>r.date.startsWith('2026-09-22')?{...r,spx:undefined}:r),{timeframe:'15'});
  near(noCash.cap[ai+6],oldCap); near(noCash.cap[ai+7],oldCap);
  assert.equal(noCash.capAnchor.at(-1),oldAnchor);
  assert.equal(noCash.capCompact.at(-1),1); assert.equal(noCash.capSessionText.at(-1),0);
  assert.equal(noCash.adrCount.at(-1),fresh.adrCount.at(-1)-1,'A cash holiday must not enter ADR history');
  const capOff=await run(adrRows,{timeframe:'15',inputs:{'Show ADR Envelope':false}});
  assert.ok(capOff.caps.every(v=>v===0)); assert.ok(capOff.labels.every(v=>v===0));
  const weekendHoliday=[...adrWarm,
    row('2026-09-20T18:00:00-04:00',7762),
    row('2026-09-21T09:30:00-04:00',7764),
    row('2026-09-21T12:45:00-04:00',7768),
    row('2026-09-21T18:00:00-04:00',7770),
    row('2026-09-22T09:30:00-04:00',7780,7761.5),
  ];
  const wh=adrWarm.length, heldFridayAnchor=ms(adrWarm.at(-3).date);
  const retained=await run(weekendHoliday,{timeframe:'15'});
  for(const offset of [0,1,2,3]) {
    near(retained.cap[wh+offset],7760.5+49.25);
    assert.equal(retained.capAnchor[wh+offset],heldFridayAnchor);
    assert.equal(retained.capCompact[wh+offset],1);
    assert.equal(retained.capSessionText[wh+offset],0);
  }
  assert.equal(retained.capAnchor[wh+4],ms(weekendHoliday[wh+4].date));
  assert.notEqual(retained.cap[wh+4],retained.cap[wh+3]);
  const shortenedFutures=[...adrWarm,
    row('2026-09-21T09:30:00-04:00',7780,7761.5),
    row('2026-09-21T12:45:00-04:00',7790,7771.5),
    row('2026-09-21T18:00:00-04:00',7792),
  ];
  const shortened=await run(shortenedFutures,{timeframe:'15'});
  near(shortened.cap[ai+2],shortened.cap[ai]);
  assert.equal(shortened.capAnchor[ai+2],ms(shortenedFutures[ai].date));
  assert.equal(shortened.capSessionText[ai+2],0,'Retained futures caps do not add session text');
  console.log('PASS ES retains fixed, cash-anchored caps through 18:00/weekend/holiday/missing opens and replaces only on a valid cash envelope');
  const toSpy=value=>value==null?undefined:(value-18.5)/10-1.6;
  const spyAdrRows=adrRows.map(r=>({...r,close:toSpy(r.close),open:toSpy(r.open),high:toSpy(r.high),low:toSpy(r.low)}));
  const spyAdr=await run(spyAdrRows,{spy:true,timeframe:'15'});
  for(const offset of [4,5]) {
    assert.equal(spyAdr.caps[ai+offset],0); assert.equal(spyAdr.labels[ai+offset],0);
    assert.equal(spyAdr.rthCurrent[ai+offset],0);
  }
  near(spyAdr.cap[ai+6],toSpy(7840)+priorAdr/10);
  near(spyAdr.capDown[ai+6],toSpy(7840)-priorAdr/10);
  assert.equal(spyAdr.capCompact[ai+6],1);
  assert.equal(spyAdr.caps[ai+8],0,'The normal 15:45-16:00 confirmed bar must clear SPY caps');
  assert.equal(spyAdr.caps[ai+9],0); assert.equal(spyAdr.caps[ai+10],0);
  const spyRth=spyAdrRows.filter(r=>/T(09:30|15:45):/.test(r.date));
  const spyRegular=await run(spyRth,{spy:true,timeframe:'15'});
  assert.equal(spyRegular.caps.at(-1),0);
  const spyRthOpen=spyRth.findIndex(r=>r.date===adrToday[6].date);
  near(spyRegular.cap[spyRthOpen],toSpy(7840)+priorAdr/10);
  const spyDelayedRows=spyAdrRows.filter(r=>/T(09:30|09:45|15:45):/.test(r.date)).map(r=>r.date===adrToday[6].date?{...r,spx:undefined}:r);
  const spyDelayedOpen=spyDelayedRows.findIndex(r=>r.date===adrToday[6].date);
  const spyDelayed=await run(spyDelayedRows,{spy:true,timeframe:'15'});
  assert.equal(spyDelayed.caps[spyDelayedOpen],0);
  near(spyDelayed.cap[spyDelayedOpen+1],toSpy(7840)+priorAdr/10);
  assert.equal(spyDelayed.caps.at(-1),0,'A delayed quote may draw before, but never only on, the confirmed final bar');
  const earlyCloseRows=[...spyAdrRows.slice(0,ai),
    row('2026-09-21T09:30:00-04:00',toSpy(7840),7821.5,{sessionMarket:true}),
    row('2026-09-21T12:45:00-04:00',toSpy(7850),7831.5,{sessionMarket:true,sessionLastbarRegular:true,barConfirmed:true}),
    row('2026-09-21T13:00:00-04:00',toSpy(7851),undefined,{sessionMarket:false}),
  ];
  const ec=ai;
  const earlyClose=await run(earlyCloseRows,{spy:true,timeframe:'15'});
  assert.equal(earlyClose.caps[ec],2);
  assert.equal(earlyClose.caps[ec+1],0,'A confirmed 12:45-13:00 last regular bar must clear SPY caps');
  assert.equal(earlyClose.caps[ec+2],0,'A forward-filled SPX quote after an early close must not redraw SPY caps');
  const unconfirmedEarlyRows=earlyCloseRows.slice(0,-1).map((r,i)=>i===ec+1?{...r,barConfirmed:false}:r);
  const unconfirmedEarly=await run(unconfirmedEarlyRows,{spy:true,timeframe:'15'});
  assert.equal(unconfirmedEarly.caps.at(-1),2,'The last-regular flag must wait for a confirmed update before cleanup');
  assert.equal(unconfirmedEarly.capEnd.at(-1),ms('2026-09-21T13:00:00-04:00'),'An unconfirmed early-close cap must end at the exchange close');
  const nextCashRows=[...spyAdrRows.map((r,i)=>i===ai+8?{...r,high:800,low:700}:r),
    // Freeze TV feed semantics: PineTS otherwise treats today's latest closed bar
    // as session.islastbar_regular based on wall-clock time and fixture truncation.
    row('2026-09-23T09:30:00-04:00',toSpy(7860),7841.5,
      {sessionMarket:true,sessionLastbarRegular:false,barConfirmed:true})];
  const nextCash=await run(nextCashRows,{spy:true,timeframe:'15'});
  assert.equal(nextCash.capAnchor.at(-1),ms(nextCashRows.at(-1).date));
  assert.equal(nextCash.capStart.at(-1),ms(nextCashRows.at(-1).date));
  assert.equal(nextCash.capCompact.at(-1),1); assert.equal(nextCash.capSessionText.at(-1),0);
  const nextAdr=(12*4.925+8.35+100)/14;
  near(nextCash.adr.at(-1),nextAdr);
  near(nextCash.cap.at(-1),toSpy(7860)+nextAdr);
  console.log('PASS ADR-10/14 and SPY cash-only lifecycle: delayed quote, normal/early close cleanup, postmarket exclusion, and next-open replacement');
  // Regression: a 44-point ADR, SPX anchor ~7600 and a <100-point
  // rise. The former independent 0.75x 25-tier span stopped at SPX 7625.
  const warm=[];
  for(let d=ms('2026-08-20T00:00:00Z');d<=ms('2026-09-10T00:00:00Z');d+=86400000){
    const date=new Date(d).toISOString().slice(0,10), dow=new Date(d).getUTCDay();
    if(dow===0||dow===6||date==='2026-09-07')continue;
    warm.push(row(date+'T09:30:00-04:00',7606.5,7600,{high:7628.5,low:7584.5}));
    warm.push(row(date+'T15:55:00-04:00',7606.5,7600));
    warm.push(row(date+'T16:00:00-04:00',7606.5));
  }
  const trend=[...warm,row('2026-09-10T18:00:00-04:00',7606.5),row('2026-09-11T10:20:00-04:00',7676.25,7669.75)];
  const allTiers={'Show 25-Point Levels':true,'Show Margin of Error Zones':true};
  const filled=await run(trend,{inputs:allTiers});
  near(filled.adr.at(-1),44); assert.equal(filled.n100.at(-1),2); assert.equal(filled.n50.at(-1),4);
  assert.equal(filled.has7675.at(-1),1); near(filled.target7675.at(-1),7681.5);
  assert.equal(filled.count25.at(-1),8); assert.equal(filled.zones25.at(-1),8);
  near(filled.low25.at(-1),7425); near(filled.high25.at(-1),7775);
  assert.equal(filled.start.at(-1),ms('2026-09-10T18:00:00-04:00'));
  console.log('PASS 25-point gaps fill the 50-grid before a 100-point recenter');
  // Regression (SPY 1h): implied SPX ~7730 rounded the 100s
  // to 7700 (7500-7900) but the 50s to 7750 (7650-7850), leaving SPX 7550 undrawn
  // below price. All tiers now share the 50-grid centre, so both sides match.
  for(const [anchor,low100,high100,low50,high50] of [[7730,7500,7900,7550,7850],[7710,7500,7900,7550,7850],[7670,7400,7800,7450,7750],[7640,7400,7800,7450,7750]]) {
    const offCentre=[...warm,row('2026-09-10T18:00:00-04:00',anchor+6.5)];
    const grid=await run(offCentre);
    assert.equal(grid.n50.at(-1),4); assert.equal(grid.n100.at(-1),2);
    near(grid.low100.at(-1),low100); near(grid.high100.at(-1),high100);
    near(grid.low50.at(-1),low50); near(grid.high50.at(-1),high50);
    near(grid.low100.at(-1)+grid.high100.at(-1),grid.low50.at(-1)+grid.high50.at(-1));
    assert.ok(grid.low100.at(-1)<grid.low50.at(-1) && grid.high100.at(-1)>grid.high50.at(-1),'100s extend past the 50-grid');
    near(grid.reach100.at(-1),grid.high100.at(-1)-(grid.low100.at(-1)+grid.high100.at(-1))/2);
    // Regression: a wide 100-span drew lone 100s far past the grid. With the
    // 50s on, the 100s frame the 50-grid plus one step, whatever the 100-span says.
    const wide=await run(offCentre,{inputs:{'    100-Point Span (when 50s hidden, x expected move)':8}});
    near(wide.low100.at(-1),low100); near(wide.high100.at(-1),high100);
  }
  // Many sessions with opens landing near 50s and near 100s: every session, past and
  // current, must draw the same ladder shape (9 lines at a normal ADR).
  const opens=[7606,7641,7662,7689,7712,7648,7655,7631,7699,7674,7627,7652,7688,7603];
  // Starts in July so ADR-14 is warm for the last 5+ sessions (before that the span
  // uses a fallback estimate, which can legitimately size the ladder differently).
  const varied=[];
  let di=0;
  for(let d=ms('2026-07-20T00:00:00Z');d<=ms('2026-09-10T00:00:00Z');d+=86400000){
    const date=new Date(d).toISOString().slice(0,10), dow=new Date(d).getUTCDay();
    if(dow===0||dow===6||date==='2026-09-07')continue;
    const o=opens[di++%opens.length];
    varied.push(row(date+'T09:30:00-04:00',o+6.5,o,{high:o+28.5,low:o-15.5}));
    varied.push(row(date+'T15:55:00-04:00',o+6.5,o));
    varied.push(row(date+'T16:00:00-04:00',o+6.5));
    varied.push(row(date+'T18:00:00-04:00',o+6.5));
  }
  const consistent=await run(varied,{inputs:{'Previous Sessions to Show':5}});
  assert.equal(consistent.gridLines.at(-1),9,'live ladder: 5 hundreds + 4 fifties');
  assert.equal(consistent.histSessions.at(-1),5);
  assert.equal(consistent.histLines.at(-1),5*9,'every past session drew the same 9-line ladder');
  // Sticky centre: a session opening at 7660, within one 100 of the previous ladder's
  // 7600 centre, keeps 7600 instead of jumping to 7700. At 7710 it moves to 7700.
  const stuck=await run([...warm,row('2026-09-10T18:00:00-04:00',7666.5)]);
  near(stuck.low100.at(-1),7400); near(stuck.high100.at(-1),7800);
  const moved=await run([...warm,row('2026-09-10T18:00:00-04:00',7716.5)]);
  near(moved.low100.at(-1),7500); near(moved.high100.at(-1),7900);
  console.log('PASS 100- and 50-point tiers share one centre, so neither side of price loses a level');
  // Historical grids: each completed session keeps its own lines, clipped to end where
  // the next session began, never overlapping the current grid; oldest are deleted.
  for(const [keep,zonesOn] of [[2,false],[5,true],[0,false]]) {
    const h=await run(warm,{inputs:{'Previous Sessions to Show':keep,'Show Margin of Error Zones':zonesOn,'Show 25-Point Levels':true}});
    assert.equal(h.histSessions.at(-1),keep,`keeps ${keep} sessions`);
    assert.ok(h.histSessions.every(x=>x<=keep));
    assert.ok(h.histLeak.every(x=>x===0),'history never overlaps the current session');
    assert.ok(h.histBad.every(x=>x===0),'every historical line has positive length');
    if(keep===0) assert.ok(h.histLines.every(x=>x===0));
    else { assert.ok(h.histLines.at(-1)>0); assert.ok(h.gridLines.at(-1)>0); }
    if(zonesOn) assert.ok(h.histZones.at(-1)>0); else assert.equal(h.histZones.at(-1),0);
  }
  // The densest grid (about 81 lines per session) with 5 past sessions must stay under
  // the 500-line cap, or TradingView would silently delete the oldest drawings,
  // including the ADR lines. The oldest-first trim is a guard if the caps ever change.
  const dense=await run(warm,{inputs:{'Previous Sessions to Show':5,'Show Margin of Error Zones':true,'Show 25-Point Levels':true,'Level Span Mode':'Fixed Count','Fixed Count: Levels Each Side':10}});
  assert.ok(dense.gridLines.at(-1)>=80,'dense live grid drawn in full');
  assert.ok(dense.histLines.every((x,i)=>x+dense.gridLines[i]<=490),'history plus live grid stays under budget');
  assert.equal(dense.histSessions.at(-1),Math.min(5,Math.floor(490/dense.gridLines.at(-1))-1),'keeps as many sessions as fit');
  assert.ok(dense.histLeak.every(x=>x===0));
  console.log('PASS previous-session grids are kept, bounded to their own session, and capped, and yield to the live grid under the 500-line limit');
  const checkQuarters=(result,lo,hi,count)=>{
    near(result.low25.at(-1),lo); near(result.high25.at(-1),hi);
    assert.equal(result.count25.at(-1),count); assert.equal(result.spacing25.at(-1),1);
    assert.equal(result.zones25.at(-1),count);
  };
  checkQuarters(filled,7425,7775,8); near(filled.zoneWidth25.at(-1),10);
  // A 50-grid ending on a 50 (centre 7650: 7550-7750) rounds out to the 100s at
  // 7500 and 7800, and the 25s fill that last gap too.
  // Opens either side of 7650 keep the previous 7600 centre (sticky); an open more
  // than 100 away moves it. The shape (9 lines, 100s at each end) is identical.
  for(const [anchor,lo,hi] of [[7649.9,7425,7775],[7650.1,7425,7775],[7720,7525,7875]]){
    const rr=await run([...warm,row('2026-09-10T18:00:00-04:00',anchor+6.5)],{inputs:allTiers});
    checkQuarters(rr,lo,hi,8);
    near(rr.high100.at(-1)-rr.low100.at(-1),400); assert.equal(rr.gridLines.at(-1),9+8);
  }
  for(const [num,count,lo,hi] of [[3,12,7325,7875],[10,40,6625,8575]]){
    const rr=await run(trend,{inputs:{...allTiers,'Level Span Mode':'Fixed Count','Fixed Count: Levels Each Side':num}});
    checkQuarters(rr,lo,hi,count); assert.ok(rr.gridLines.at(-1)<=92);
  }
  const standalone=await run(trend,{inputs:{...allTiers,'Show 50-Point Levels':false}});
  checkQuarters(standalone,7575,7625,2);
  const hidden=await run(trend,{inputs:{'Show Margin of Error Zones':true}});
  assert.equal(hidden.count25.at(-1),0); assert.equal(hidden.zones25.at(-1),0);
  const staticGrid=await run(trend,{inputs:{...allTiers,'Re-centre Grid on Trend':false}});
  checkQuarters(staticGrid,7425,7775,8);
  const spyTrend=trend.map(r=>({...r,close:(r.close-6.5)/10-1.6,
    high:r.high==null?undefined:(r.high-6.5)/10-1.6,low:r.low==null?undefined:(r.low-6.5)/10-1.6}));
  const spyFill=await run(spyTrend,{spy:true,inputs:allTiers});
  // SPY starts a new calendar-date grid on the final bar near SPX 7650; it keeps the
  // previous 7600 centre because the open is within one 100 of it.
  checkQuarters(spyFill,7425,7775,8); near(spyFill.target7675.at(-1),765.9); near(spyFill.zoneWidth25.at(-1),1);
  console.log('PASS exact quarter spacing/edges, count modes/limits, hidden/standalone tiers and SPY scaling');
  const bounds=[
    ['2026-03-08T01:55:00-05:00','2026-03-07T18:00:00-05:00','2026-03-08T18:00:00-04:00'],
    ['2026-03-08T03:05:00-04:00','2026-03-07T18:00:00-05:00','2026-03-08T18:00:00-04:00'],
    ['2026-11-01T01:55:00-04:00','2026-10-31T18:00:00-04:00','2026-11-01T18:00:00-05:00'],
    ['2026-11-01T01:05:00-05:00','2026-10-31T18:00:00-04:00','2026-11-01T18:00:00-05:00'],
    ['2027-01-01T09:30:00-05:00','2026-12-31T18:00:00-05:00','2027-01-01T18:00:00-05:00'],
  ];
  for(const [time,key,end] of bounds){const b=await run([row(time,7710)]);assert.equal(b.key[0],ms(key));assert.equal(b.end[0],ms(end));}
  console.log('PASS spring/fall DST and year rollover calendar boundaries');
  const mes=await run(rth,{symbol:'MES1!'});
  assert.ok(mes.gridLines.at(-1)>0); assert.equal(mes.infoTable.at(-1),1);
  near(mes.cap.at(-1),773.4); assert.equal(mes.labels.at(-1),2);
  const mesRetention=await run(adrRows,{symbol:'MES1!',timeframe:'15'});
  near(mesRetention.cap[ai+3],oldCap);
  assert.equal(mesRetention.capAnchor[ai+3],oldAnchor);
  assert.equal(mesRetention.capSessionText[ai+3],0);
  assert.equal(mesRetention.capAnchor[ai+6],ms(adrToday[6].date));
  const rollStart=adrWarm.findIndex(r=>r.date.startsWith('2026-09-14'));
  for(const symbol of ['ESZ2026','MESZ2026']) {
    const dated=await run(adrRows,{symbol,timeframe:'15'});
    assert.ok(dated.caps.slice(0,rollStart).every(x=>x===0),`${symbol}: pre-roll calculation history must not draw caps`);
    assert.ok(dated.infoTable.slice(0,rollStart).every(x=>x===0),`${symbol}: pre-roll calculation history must not create a table`);
    near(dated.cap[ai],7809.75);
    assert.equal(dated.caps[ai],2); assert.equal(dated.infoTable[ai],1);
    assert.ok(dated.adrCount[ai]>=14,`${symbol}: pre-roll sessions must warm ADR history`);
  }
  const oldContractRows=[...rth,
    row('2026-09-10T09:30:00-04:00',769,7700,{high:769.2,low:768.8}),
    row('2026-09-10T15:55:00-04:00',773,7740,{high:773.2,low:772.8}),
    row('2026-09-11T09:30:00-04:00',769,7700,{high:769.2,low:768.8}),
    row('2026-09-11T15:55:00-04:00',773,7740,{high:773.2,low:772.8}),
    row('2026-09-14T09:30:00-04:00',769,7700,{high:769.2,low:768.8}),
    row('2026-09-14T10:30:00-04:00',771,7720,{high:771.2,low:770.8}),
    row('2026-09-14T15:55:00-04:00',773,7740,{high:773.2,low:772.8}),
    row('2026-09-15T09:30:00-04:00',769,7700,{high:769.2,low:768.8}),
  ];
  const oldRoll=oldContractRows.findIndex(r=>r.date==='2026-09-14T10:30:00-04:00');
  const oldContract=await run(oldContractRows,{symbol:'ESU2026'});
  assert.equal(oldContract.caps[oldRoll-1],2); assert.equal(oldContract.infoTable[oldRoll-1],1);
  assert.ok(oldContract.caps.slice(oldRoll).every(x=>x===0),'Expired ESU2026 caps must clear at the roll');
  assert.ok(oldContract.labels.slice(oldRoll).every(x=>x===0),'Expired ESU2026 labels must clear at the roll');
  assert.ok(oldContract.infoTable.slice(oldRoll).every(x=>x===0),'Expired ESU2026 table must remain hidden after the roll');
  for(const symbol of ['QQQ','AAPL','NQ1!','SPX']) {
    const blank=await run(rth,{symbol,rejectRates:true,inputs:{
      'Fair Value Mode':'Theoretical',
      'Model Rate Source':'FRED',
      'Show Margin of Error Zones':true,
      'Show 25-Point Levels':true,
    }});
    assert.equal(blank.fredCalls.at(-1)+blank.tsyCalls.at(-1),0,`${symbol}: invalid symbols must not enter the rate path`);
    for(const key of ['gridLines','zones','caps','labels','infoTable']) {
      assert.ok(blank[key].every(x=>x===0),`${symbol}: ${key} must remain blank`);
    }
  }
  console.log('PASS MES remains supported; QQQ/AAPL/NQ/SPX are fully blank and cannot trigger FRED');
  const boundaryIndex=(raw,parent)=>raw.findLastIndex(r=>ms(r.date)>=ms(parent.date)&&ms(r.date)+300000<=parent.end);
  const sameValue=(actual,expected,message)=>{
    if(Number.isNaN(expected)) assert.ok(Number.isNaN(actual),message);
    else if(typeof expected==='number') assert.ok(Math.abs(actual-expected)<1e-6,`${message}: ${actual} != ${expected}`);
    else assert.equal(actual,expected,message);
  };
  const compareParentBoundaries=(native,higher,raw,parents,label)=>{
    const keys=['start','end','basis','sampled','active','mapped','pending','anchor','adrCount','adr','rthOpen','rthCurrent',
      'cap','capDown','capAnchor','processed','gridLines','n100','n50','n25','count25','has7675'];
    parents.forEach((parent,parentIndex)=>{
      const nativeIndex=boundaryIndex(raw,parent);
      assert.ok(nativeIndex>=0,`${label}: parent ${parentIndex} has a child fixture`);
      for(const key of keys) sameValue(higher[key][parentIndex],native[key][nativeIndex],`${label}: ${key} at parent ${parentIndex}`);
    });
  };
  const esReplay=adrRows.map(r=>/T18:00:/.test(r.date)?{...r,high:9000,low:7000}:r);
  const spyReplay=spyAdrRows.map(r=>({...r,
    sessionMarket:/T(09:30|09:45|15:45):/.test(r.date),
    sessionLastbarRegular:/T15:45:/.test(r.date),
  }));
  const compactEs=[
    row('2026-09-21T18:00:00-04:00',7800),
    row('2026-09-22T09:25:00-04:00',7810),
    row('2026-09-22T09:30:00-04:00',7811,7792.5),
    row('2026-09-22T09:35:00-04:00',7815,7793),
    row('2026-09-22T10:05:00-04:00',7818,7795),
    row('2026-09-22T15:55:00-04:00',7820,7797),
    row('2026-09-22T16:00:00-04:00',7821),
    row('2026-09-22T18:00:00-04:00',7822),
    row('2026-09-23T09:30:00-04:00',7824,7800),
  ];
  const compactSpy=compactEs.map(r=>({...r,close:toSpy(r.close),
    sessionMarket:/T(09:30|09:35|10:05|15:55):/.test(r.date),
    sessionLastbarRegular:/T15:55:/.test(r.date)}));
  const replayInputs={'Show 25-Point Levels':true};
  for(const [symbol,spyChart,raw] of [['ES1!',false,compactEs],['MES1!',false,compactEs],['SPY',true,compactSpy]]) {
    const native=await run(raw,{symbol,spy:spyChart,inputs:replayInputs,rejectFred:true});
    for(const timeframe of ['60','120','180','240']) {
      const parents=parentize(raw,timeframe,spyChart);
      const higher=await run(parents,{symbol,spy:spyChart,timeframe,lowerRows:raw,inputs:replayInputs,rejectFred:true});
      compareParentBoundaries(native,higher,raw,parents,`${symbol}/${timeframe}`);
      assert.ok(higher._lowerRequests.some(r=>r.tickerId==='SP:SPX'||r.tickerId==='SPX'),`${symbol}/${timeframe}: SPX intrabars requested`);
      assert.ok(higher._lowerRequests.some(r=>r.tickerId===symbol),`${symbol}/${timeframe}: chart intrabars requested`);
      assert.equal(higher.fredCalls.at(-1)+higher.tsyCalls.at(-1),0,`${symbol}/${timeframe}: default path must not request rates`);
    }
  }
  const esReplayNative=await run(esReplay,{inputs:replayInputs});
  const esReplayParents=parentize(esReplay,'240');
  const esReplayHigher=await run(esReplayParents,{timeframe:'240',lowerRows:esReplay,inputs:replayInputs});
  compareParentBoundaries(esReplayNative,esReplayHigher,esReplay,esReplayParents,'ES1!/240 full ADR replay');
  const esOvernight=esReplay.findIndex(r=>r.date==='2026-09-21T18:00:00-04:00');
  assert.equal(esReplayNative.start[esOvernight],ms(esReplay[esOvernight].date),'18:00 resets the grid');
  assert.notEqual(esReplayNative.capAnchor[esOvernight],ms(esReplay[esOvernight].date),'18:00 does not reanchor ADR');
  assert.ok(esReplayNative.adr.at(-1)<100,'overnight extremes stay out of cash ADR');
  console.log('PASS deterministic 1h/2h/3h/4h replay matches native 5-minute state at ES/MES/SPY parent boundaries');

  // This historical batch test intentionally does not model TradingView rollback.
  // Changing basis on every child makes a duplicate replay observable in the EMA.
  const joinRows=[
    row('2026-09-22T09:25:00-04:00',7710),
    row('2026-09-22T09:30:00-04:00',7711,7700),
    row('2026-09-22T09:35:00-04:00',7715),
    row('2026-09-22T09:40:00-04:00',7714,7702,{quote:{time:ms('2026-09-22T09:45:00-04:00')}}),
    row('2026-09-22T09:45:00-04:00',7718,7703),
    row('2026-09-22T09:50:00-04:00',7720,7704),
  ];
  const joinNative=await run(joinRows);
  const joinParents=parentize(joinRows,'60');
  const joined=await run(joinParents,{timeframe:'60',lowerRows:joinRows});
  compareParentBoundaries(joinNative,joined,joinRows,joinParents,'unequal timestamp join');
  near(joined.basis.at(-1),joinNative.basis.at(-1));
  assert.equal(joined.sampled.at(-1),ms(joinRows.at(-1).date));
  console.log('PASS unequal/unmatched SPX arrays join by timestamp and each historical replay batch processes once');

  const emptyParent=[row('2026-09-22T08:00:00-04:00',7710,undefined,{end:ms('2026-09-22T12:00:00-04:00')})];
  const empty=await run(emptyParent,{timeframe:'240',lowerRows:[],rejectFred:true});
  assert.ok(Number.isNaN(empty.processed[0])); assert.equal(empty.caps[0],0); assert.equal(empty.labels[0],0);
  assert.equal(empty.gridLines[0],0); assert.equal(empty.infoTable[0],0); assert.equal(empty.fredCalls[0],0);
  const htfFilled=await run(parentize(trend,'240'),{timeframe:'240',lowerRows:trend,inputs:allTiers});
  assert.equal(htfFilled.has7675.at(-1),filled.has7675.at(-1));
  assert.equal(htfFilled.count25.at(-1),filled.count25.at(-1));
  near(htfFilled.target7675.at(-1),filled.target7675.at(-1));
  console.log('PASS empty lower-history bars stay quiet; higher-timeframe 25-point gap coverage matches native');

  const spyCloseWarm=spyReplay.slice(0,ai);
  const htfSpyRegularRows=[...spyCloseWarm,
    row('2026-09-21T09:30:00-04:00',toSpy(7840),7821.5,{sessionMarket:true}),
    row('2026-09-21T15:50:00-04:00',toSpy(7850),7831.5,{sessionMarket:true})];
  const regularParents=parentize(htfSpyRegularRows,'240',true);
  regularParents.at(-1).end=ms('2026-09-21T16:00:00-04:00');
  regularParents.at(-1).sessionMarket=true;
  const confirmedClose=await run(regularParents,{spy:true,timeframe:'240',lowerRows:htfSpyRegularRows});
  assert.equal(confirmedClose.caps.at(-1),0,'confirmed parent close clears SPY when the final intrabar is absent');
  const developingParents=regularParents.map((r,i)=>i===regularParents.length-1?{...r,barConfirmed:false}:r);
  const developingClose=await run(developingParents,{spy:true,timeframe:'240',lowerRows:htfSpyRegularRows});
  assert.equal(developingClose.caps.at(-1),2,'developing parent must not clear SPY caps early');
  const spyEarly=[...spyCloseWarm,
    row('2026-09-22T09:30:00-04:00',toSpy(7840),7821.5,{sessionMarket:true}),
    row('2026-09-22T12:55:00-04:00',toSpy(7850),7831.5,{sessionMarket:true,sessionLastbarRegular:true})];
  const earlyNative=await run(spyEarly,{spy:true});
  const earlyParents=parentize(spyEarly,'240',true);
  const earlyHigher=await run(earlyParents,{spy:true,timeframe:'240',lowerRows:spyEarly});
  compareParentBoundaries(earlyNative,earlyHigher,spyEarly,earlyParents,'SPY early close');
  assert.equal(earlyHigher.caps.at(-1),0,'last-regular intrabar clears an early-close envelope');
  console.log('PASS SPY regular/early close inside parent bars and confirmed-parent fallback cleanup');

  for(const timeframe of ['20','45','360','D']) {
    for(const spy of [false,true]) {
      for(const mode of ['Observed','Blended','Theoretical']) {
        const blank=await run(rth,{timeframe,spy,rejectRates:true,inputs:{'Fair Value Mode':mode,'Show Margin of Error Zones':true,'Model Rate Source':'FRED'}});
        for(const key of ['gridLines','zones','caps','labels','infoTable']) {
          assert.ok(blank[key].every(x=>x===0), `${timeframe}/${spy?'SPY':'ES'}/${mode}: ${key} must remain hidden`);
        }
      }
    }
  }
  console.log('PASS unsupported timeframes run without errors and create no drawings or table (ES/SPY, all modes)');
})().catch(e=>{console.error(e.message);console.error(e.stack?.split('\n').slice(0,5).join('\n'));process.exitCode=1;});
