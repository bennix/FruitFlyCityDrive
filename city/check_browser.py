import json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=True,args=['--enable-webgl','--ignore-gpu-blocklist'])
 page=b.new_page(viewport={'width':1512,'height':1040})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8080');page.wait_for_timeout(1200)
 # A real directed section of Yan'an elevated road, actual network output, no mocks.
 page.locator('#start').select_option('110');page.locator('#end').select_option('111');page.locator('#learn').uncheck()
 page.locator('#speed').fill('4');page.locator('#run').click()
 page.wait_for_function("document.getElementById('status').textContent==='抵达终点'",timeout=60000)
 print('REAL ARRIVAL',page.evaluate('window.cityLab.getState()'),flush=True)
 with page.expect_download() as dl:page.locator('#export').click()
 dl.value.save_as('artifacts/city/arrival.json')
 page.locator('#end').select_option('389');page.locator('#learn').check();page.locator('#run').click()
 page.wait_for_function("Number(document.getElementById('learnCount').textContent)>=2",timeout=80000)
 print('ONLINE LEARNING',page.locator('#learnCount').inner_text(),page.evaluate('window.cityLab.getState()'),flush=True)
 page.screenshot(path='artifacts/city/running.png')
 page.locator('#run').click()
 with page.expect_download() as dl:page.locator('#export').click()
 dl.value.save_as('artifacts/city/experiment.json')
 # Freeze policy immediately, then verify persistence across refresh.
 learned=page.locator('#learnCount').inner_text();page.reload();page.wait_for_timeout(1500);assert page.locator('#learnCount').inner_text()==learned
 mm=page.locator('#minimap');mm.click(position={'x':65,'y':65});mm.click(position={'x':90,'y':100});assert len(page.evaluate('window.cityLab.getState().path'))>1
 page.locator('#follow').click();page.wait_for_timeout(500);page.locator('#top').click();page.wait_for_timeout(500)
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path='artifacts/city/mobile.png');assert page.evaluate('document.documentElement.scrollWidth')==390
 print('PASS persistence, minimap selections, views, responsive layout; errors=',errors,flush=True)
 assert not errors
 b.close()
