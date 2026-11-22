// ==========================================
// 5. ระบบคาลิเบรต 3 จุดทั่วทั้งภาพ (แก้ Letterbox / หมุนจอ / สเกล 100%)
// ==========================================
function ensureCapture(scr) {
    if (!hasCapturePerm) {
        if (!requestScreenCapture(scr.w >= scr.h)) { toast("ไม่ได้รับสิทธิ์จับภาพหน้าจอ"); return false; }
        hasCapturePerm = true;
        sleep(800);
    }
    if (!CAL.ok) {
        calibrate3Points(scr);
    }
    return true;
}

function findMagentaCentroid(img) {
    let pt = images.findColor(img, "#FF00FF", { threshold: 40 });
    if (!pt) return null;
    let imgW = img.getWidth(), imgH = img.getHeight();
    let x1 = Math.max(0, pt.x - 45), y1 = Math.max(0, pt.y - 45);
    let x2 = Math.min(imgW - 1, pt.x + 45), y2 = Math.min(imgH - 1, pt.y + 45);
    let w = x2 - x1 + 1, h = y2 - y1 + 1;
    let buf = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, w * h);
    img.getBitmap().getPixels(buf, 0, w, x1, y1, w, h);
    let sx = 0, sy = 0, cnt = 0;
    for (let ly = 0; ly < h; ly++) {
        let rowOff = ly * w;
        for (let lx = 0; lx < w; lx++) {
            let px = buf[rowOff + lx];
            let r = (px >> 16) & 0xFF, g = (px >> 8) & 0xFF, b = px & 0xFF;
            if (r >= 200 && g <= 65 && b >= 200) { sx += (x1 + lx); sy += (y1 + ly); cnt++; }
        }
    }
    return cnt >= 8 ? { u: sx / cnt, v: sy / cnt } : null;
}

function calibrate3Points(scr) {
    hideBlackMask();
    let calWin = null;
    try {
        calWin = floaty.rawWindow(<frame id="box" bg="#FFFF00FF" w="44" h="44"/>);
        calWin.setTouchable(false);
        ui.run(() => { try { calWin.box.setBackgroundColor(colors.parseColor("#FFFF00FF")); } catch (e) {} });

        let targets = [
            { x: Math.round(scr.w * 0.28), y: Math.round(scr.h * 0.28) },
            { x: Math.round(scr.w * 0.74), y: Math.round(scr.h * 0.28) },
            { x: Math.round(scr.w * 0.28), y: Math.round(scr.h * 0.72) }
        ];
        let P = [], Q = [];

        for (let i = 0; i < 3; i++) {
            calWin.setPosition(targets[i].x, targets[i].y);
            sleep(240);
            let realP = getViewCenter(calWin.box, calWin);
            sleep(100);
            let q = findMagentaCentroid(captureScreen());
            if (!q) { sleep(180); q = findMagentaCentroid(captureScreen()); }
            if (!q) throw "ไม่พบจุดคาลิเบรตที่ " + (i + 1);
            P.push(realP);
            Q.push(q);
        }

        try { calWin.close(); } catch (e) {}
        calWin = null;

        let dx1 = P[1].x - P[0].x, dy1 = P[1].y - P[0].y;
        let dx2 = P[2].x - P[0].x, dy2 = P[2].y - P[0].y;
        let det = dx1 * dy2 - dy1 * dx2;
        if (Math.abs(det) < 1000) throw "det เล็กเกินไป";

        let du1 = Q[1].u - Q[0].u, dv1 = Q[1].v - Q[0].v;
        let du2 = Q[2].u - Q[0].u, dv2 = Q[2].v - Q[0].v;

        let dudx = (dy2 * du1 - dy1 * du2) / det;
        let dudy = (-dx2 * du1 + dx1 * du2) / det;
        let dvdx = (dy2 * dv1 - dy1 * dv2) / det;
        let dvdy = (-dx2 * dv1 + dx1 * dv2) / det;
        let scale = Math.sqrt(dudx * dudx + dvdx * dvdx);

        CAL = {
            ok: true, x0: P[0].x, y0: P[0].y, u0: Q[0].u, v0: Q[0].v,
            dudx: dudx, dudy: dudy, dvdx: dvdx, dvdy: dvdy,
            tag: "CAL✅" + scale.toFixed(2)
        };
        addLog("คาลิเบรตสำเร็จ! สเกล " + scale.toFixed(2));
        return;
    } catch (e) {
        if (calWin) { try { calWin.close(); } catch (e2) {} }
        addLog("CalFail: " + e);
        let img2 = captureScreen();
        let imgW = img2.getWidth(), imgH = img2.getHeight();
        if ((imgW >= imgH) === (scr.w >= scr.h)) {
            CAL = { ok: true, x0: 0, y0: 0, u0: 0, v0: 0, dudx: imgW / scr.w, dudy: 0, dvdx: 0, dvdy: imgH / scr.h, tag: "สำรองNORM" };
        } else {
            let s = imgW / scr.w;
            let topBar = (imgH - scr.h * s) / 2;
            CAL = { ok: true, x0: 0, y0: 0, u0: 0, v0: topBar, dudx: s, dudy: 0, dvdx: 0, dvdy: s, tag: "สำรองBOX" };
        }
    }
}

// ดึงพิกเซลจาก Bitmap เฉพาะกรอบเล็กๆ ที่สแกน (เร็ว 1-4ms ไม่สร้าง Object ในลูป)
function grabStrip(img, rx, ry, rw, rh) {
    let imgW = img.getWidth(), imgH = img.getHeight();
    let x1 = rx, y1 = ry, x2 = rx + Math.max(0, rw - 1), y2 = ry + Math.max(0, rh - 1);
    let c0x = CAL.u0 + (x1 - CAL.x0) * CAL.dudx + (y1 - CAL.y0) * CAL.dudy;
    let c0y = CAL.v0 + (x1 - CAL.x0) * CAL.dvdx + (y1 - CAL.y0) * CAL.dvdy;
    let c1x = CAL.u0 + (x2 - CAL.x0) * CAL.dudx + (y1 - CAL.y0) * CAL.dudy;
    let c1y = CAL.v0 + (x2 - CAL.x0) * CAL.dvdx + (y1 - CAL.y0) * CAL.dvdy;
    let c2x = CAL.u0 + (x1 - CAL.x0) * CAL.dudx + (y2 - CAL.y0) * CAL.dudy;
    let c2y = CAL.v0 + (x1 - CAL.x0) * CAL.dvdx + (y2 - CAL.y0) * CAL.dvdy;
    let c3x = CAL.u0 + (x2 - CAL.x0) * CAL.dudx + (y2 - CAL.y0) * CAL.dudy;
    let c3y = CAL.v0 + (x2 - CAL.x0) * CAL.dvdx + (y2 - CAL.y0) * CAL.dvdy;

    let minIx = Math.max(0, Math.min(imgW - 1, Math.floor(Math.min(c0x, c1x, c2x, c3x)) - 1));
    let maxIx = Math.max(0, Math.min(imgW - 1, Math.ceil(Math.max(c0x, c1x, c2x, c3x)) + 1));
    let minIy = Math.max(0, Math.min(imgH - 1, Math.floor(Math.min(c0y, c1y, c2y, c3y)) - 1));
    let maxIy = Math.max(0, Math.min(imgH - 1, Math.ceil(Math.max(c0y, c1y, c2y, c3y)) + 1));

    let iw = Math.max(1, maxIx - minIx + 1);
    let ih = Math.max(1, maxIy - minIy + 1);
    let need = iw * ih;
    if (!pixelBuf || pixelBufLen < need) {
        pixelBuf = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, need);
        pixelBufLen = need;
    }
    img.getBitmap().getPixels(pixelBuf, 0, iw, minIx, minIy, iw, ih);
    return { buf: pixelBuf, ix: minIx, iy: minIy, iw: iw, ih: ih };
}

function getPix(st, x, y) {
    let lx = Math.round(CAL.u0 + (x - CAL.x0) * CAL.dudx + (y - CAL.y0) * CAL.dudy) - st.ix;
    let ly = Math.round(CAL.v0 + (x - CAL.x0) * CAL.dvdx + (y - CAL.y0) * CAL.dvdy) - st.iy;
    if (lx < 0) lx = 0; else if (lx >= st.iw) lx = st.iw - 1;
    if (ly < 0) ly = 0; else if (ly >= st.ih) ly = st.ih - 1;
    return st.buf[ly * st.iw + lx];
}

function isDark(c) {
    return (((c >> 16) & 0xFF) <= 95 && ((c >> 8) & 0xFF) <= 90 && (c & 0xFF) <= 90);
}
function isPureRed(c) {
    let r = (c >> 16) & 0xFF, g = (c >> 8) & 0xFF, b = c & 0xFF;
    return (r >= 135 && g <= 85 && b <= 85 && (r - g) >= 70 && (r - b) >= 70);
}
function isWhiteOnRed(c) {
    return (((c >> 16) & 0xFF) >= 185 && ((c >> 8) & 0xFF) >= 150 && (c & 0xFF) >= 150);
}
function isBrightWhite(c) {
    return (((c >> 16) & 0xFF) >= 210 && ((c >> 8) & 0xFF) >= 210 && (c & 0xFF) >= 210);
}

function isHoldingRod() {
    let img = captureScreen();
    let cx = CFG.fishBtn.x, cy = CFG.fishBtn.y;
    let st = grabStrip(img, cx - 22, cy - 22, 45, 45);
    let pts = [[18, 0], [-18, 0], [0, 18], [0, -18], [13, 13], [-13, -13]];
    let hits = 0;
    for (let i = 0; i < pts.length; i++) {
        let c = getPix(st, cx + pts[i][0], cy + pts[i][1]);
        let r = (c >> 16) & 0xFF, g = (c >> 8) & 0xFF, b = c & 0xFF;
        if (r >= 130 && (r - g) >= 50 && (r - b) >= 50) hits++;
    }
    return hits >= 3;
}

function findBarFast(img) {
    let rx = Math.max(0, Math.min(CFG.barStart.x, CFG.barEnd.x));
    let ry = Math.max(0, Math.min(CFG.barStart.y, CFG.barEnd.y));
    let rw = Math.max(20, Math.abs(CFG.barEnd.x - CFG.barStart.x));
    let rh = Math.max(12, Math.abs(CFG.barEnd.y - CFG.barStart.y));

    let st = grabStrip(img, rx, ry, rw, rh);
    let ratios = [0.5, 0.33, 0.67];
    let maxDarkPct = 0, barOpen = false, midRgb = "-";
    let maxValidW = Math.max(80, Math.floor(rw * 0.65));

    for (let i = 0; i < ratios.length; i++) {
        let y = Math.round(ry + rh * ratios[i]);
        if (i === 0) {
            let mc = getPix(st, rx + Math.floor(rw / 2), y);
            midRgb = ((mc >> 16) & 0xFF) + "," + ((mc >> 8) & 0xFF) + "," + (mc & 0xFF);
        }
        let darkCnt = 0, totCnt = 0, bestRun = null, runStart = -1;
        for (let x = rx; x < rx + rw; x += 2) {
            let c = getPix(st, x, y);
            totCnt++;
            if (isDark(c)) darkCnt++;
            if (isPureRed(c)) {
                if (runStart === -1) runStart = x;
            } else if (runStart !== -1) {
                let w = x - runStart;
                if (w >= 8 && w <= maxValidW && (!bestRun || w > (bestRun.maxX - bestRun.minX))) bestRun = { minX: runStart, maxX: x };
                runStart = -1;
            }
        }
        if (runStart !== -1) {
            let w = (rx + rw) - runStart;
            if (w >= 8 && w <= maxValidW && (!bestRun || w > (bestRun.maxX - bestRun.minX))) bestRun = { minX: runStart, maxX: rx + rw };
        }
        let pct = totCnt > 0 ? Math.round((darkCnt / totCnt) * 100) : 0;
        if (pct > maxDarkPct) maxDarkPct = pct;

        if (pct >= 20) {
            barOpen = true;
            if (bestRun) {
                let midX = Math.round((bestRun.minX + bestRun.maxX) / 2);
                let topY = y, botY = y;
                while (topY > ry && isPureRed(getPix(st, midX, topY - 1))) topY--;
                while (botY < ry + rh - 1 && isPureRed(getPix(st, midX, botY + 1))) botY++;
                if ((botY - topY) >= 4) {
                    bestRun.cy = Math.round((topY + botY) / 2);
                    return { open: true, darkPct: pct, redZone: bestRun, rx: rx, ry: ry, rw: rw, rh: rh, midRgb: midRgb };
                }
            }
        }
    }
    return { open: barOpen, darkPct: maxDarkPct, redZone: null, rx: rx, ry: ry, rw: rw, rh: rh, midRgb: midRgb };
}

function checkCatchFast(img, redZone, rx, rw, leadPx, needDbg) {
    let cy = redZone.cy;
    let rwZone = redZone.maxX - redZone.minX;
    let pad = Math.max(3, Math.floor(rwZone * 0.15));
    let inMin = redZone.minX + pad;
    let inMax = redZone.maxX - pad;
    if (inMax <= inMin) { inMin = redZone.minX + 2; inMax = redZone.maxX - 2; }

    let sMin = leadPx > 0 ? Math.max(rx + 2, redZone.minX - leadPx - 16) : inMin;
    let sMax = leadPx > 0 ? Math.min(rx + rw - 2, redZone.maxX + leadPx + 16) : inMax;
    let st = grabStrip(img, sMin, cy - 1, (sMax - sMin) + 1, 3);

    let hitInRed = false, hitX = -1, whiteX = -1, centerRgb = "-";
    for (let x = inMin; x <= inMax; x++) {
        let h = 0;
        if (isWhiteOnRed(getPix(st, x, cy))) h++;
        if (isWhiteOnRed(getPix(st, x, cy - 1))) h++;
        if (isWhiteOnRed(getPix(st, x, cy + 1))) h++;
        if (h >= 2) { hitInRed = true; hitX = x; whiteX = x; break; }
    }

    if (!hitInRed && leadPx > 0) {
        for (let x = sMin; x <= sMax; x += 2) {
            if (Math.abs(x - redZone.minX) <= 4 || Math.abs(x - redZone.maxX) <= 4) continue;
            if (isBrightWhite(getPix(st, x, cy)) && (isBrightWhite(getPix(st, x, cy - 1)) || isBrightWhite(getPix(st, x, cy + 1)))) {
                whiteX = x; break;
            }
        }
    }

    if (needDbg) {
        let mc = getPix(st, Math.round((inMin + inMax) / 2), cy);
        centerRgb = ((mc >> 16) & 0xFF) + "," + ((mc >> 8) & 0xFF) + "," + (mc & 0xFF);
    }
    return { hitInRed: hitInRed, hitX: hitX, whiteX: whiteX, centerRgb: centerRgb };
}

function checkBarStillOpen(img, rx, rw, cy) {
    let st = grabStrip(img, rx, cy, rw, 1);
    let darkCnt = 0, totCnt = 0;
    for (let x = rx; x < rx + rw; x += 8) {
        totCnt++;
        if (isDark(getPix(st, x, cy))) darkCnt++;
    }
    return (totCnt > 0 && (darkCnt / totCnt) >= 0.15);
}

mainWin.btnDebug.click(() => { toggleDebugWin(); });

mainWin.btnStart.click(() => {
    if (isRunning) { toast("บอทกำลังทำงานอยู่แล้ว"); return; }
    isTesting = false; closeAllPickers(); isRunning = true;
    addLog("เริ่มทำงาน v4.3");
    setStatus("กำลังคาลิเบรต 3 จุด...", "#FACC15", "รอสักครู่ (ห้ามแตะจอ)");

    botThread = threads.start(function () {
        try {
            let scr = getScreenInfo();
            if (!ensureCapture(scr)) {
                isRunning = false;
                setStatus("หยุดอยู่", "#94A3B8", "ไม่ได้รับสิทธิ์จอ");
                return;
            }
            runBotLoop(scr);
        } catch (e) {
            if (isRunning) {
                addLog("ERR: " + e);
                toast("Error: " + e);
                setStatus("เกิดข้อผิดพลาด!", "#EF4444", String(e).substring(0, 26));
                isRunning = false;
            }
        } finally { hideBlackMask(); }
    });
});

mainWin.btnStop.click(() => {
    isRunning = false; isTesting = false;
    if (botThread && botThread.isAlive()) botThread.interrupt();
    if (testThread && testThread.isAlive()) testThread.interrupt();
    hideBlackMask();
    addLog("หยุดทำงาน (ปิดม่านดำ)");
    setStatus("หยุดการทำงานแล้ว", "#F87171", "กด ▶ เริ่ม เพื่อทำงานต่อ");
});

mainWin.btnClose.click(() => {
    isRunning = false; isTesting = false;
    if (botThread && botThread.isAlive()) botThread.interrupt();
    if (testThread && testThread.isAlive()) testThread.interrupt();
    hideBlackMask(); closeAllPickers();
    try { maskTop.close(); maskBot.close(); maskLeft.close(); maskRight.close(); } catch (e) {}
    try { debugWin.close(); } catch (e) {}
    mainWin.close(); exit();
});

function runBotLoop(scr) {
    while (isRunning) {
        if (CFG.rodMode === "always") {
            addLog("กดเบ็ดช่อง 3 (โหมดกดเสมอ)");
            click(CFG.rod.x, CFG.rod.y);
            sleep(900);
        } else if (CFG.rodMode === "check") {
            if (!isHoldingRod()) {
                addLog("ไม่พบปุ่มตก -> กดช่อง 3");
                click(CFG.rod.x, CFG.rod.y);
                sleep(900);
            }
        }

        showBlackMask(scr);
        addLog("เปิดม่านดำ (" + CAL.tag + ")");
        sleep(250);

        for (let r = 1; r <= CFG.fishRounds; r++) {
            if (!isRunning) return;
            playFishingRound(r, scr);
        }

        if (!isRunning) return;
        hideBlackMask();
        addLog("ครบรอบ -> ปิดม่านดำเข้าคลัง");
        sleep(350);
        storeItemsToVault();
    }
}

function playFishingRound(roundNum, scr) {
    setStatus("ปาเบ็ด...", "#4ADE80", "รอบที่ " + roundNum + " / " + CFG.fishRounds);
    addLog("รอบ " + roundNum + ": ปาเบ็ด");
    click(CFG.fishBtn.x, CFG.fishBtn.y);
    sleep(1100);

    setStatus("รอปลากินเบ็ด...", "#FACC15", "รอบที่ " + roundNum + " / " + CFG.fishRounds);
    let barState = null;
    let waitStart = new Date().getTime();

    while (isRunning && (new Date().getTime() - waitStart < 22000)) {
        let t0 = new Date().getTime();
        let img = captureScreen();
        let t1 = new Date().getTime();
        let st = findBarFast(img);
        let t2 = new Date().getTime();

        if (isDebugOpen) {
            updateDebugMetrics({
                meta: "จอ:" + scr.w + "x" + scr.h + " ภาพ:" + img.getWidth() + "x" + img.getHeight() + " " + CAL.tag,
                scan: "ดำ:" + st.darkPct + "% | แดง:" + (st.redZone ? (st.redZone.minX + "-" + st.redZone.maxX) : "รอ..."),
                rgb: "RGB:" + st.midRgb + " | แคป:" + (t1 - t0) + "ms สแกน:" + (t2 - t1) + "ms"
            }, false);
        }

        if (st.open && st.redZone) {
            barState = st;
            addLog("เจอแดง X=" + st.redZone.minX + "-" + st.redZone.maxX + " (สแกน " + (t2 - t1) + "ms)");
            break;
        }
        sleep(25);
    }

    if (!barState || !isRunning) {
        addLog("หมดเวลารอปลากิน");
        return;
    }

    let redZone = barState.redZone;
    setStatus("🎯 เจอแดง! โหมด Turbo", "#FB923C", "รอบที่ " + roundNum + " / " + CFG.fishRounds);
    let catchStart = new Date().getTime();
    let prevWhiteX = -1, frameCnt = 0, closedCnt = 0;

    while (isRunning && (new Date().getTime() - catchStart < 10000)) {
        let t0 = new Date().getTime();
        let img = captureScreen();
        let t1 = new Date().getTime();
        let res = checkCatchFast(img, redZone, barState.rx, barState.rw, CFG.leadPx, isDebugOpen);
        let t2 = new Date().getTime();

        let leadHit = false;
        if (!res.hitInRed && CFG.leadPx > 0 && res.whiteX >= 0 && prevWhiteX >= 0) {
            let vx = res.whiteX - prevWhiteX;
            if (vx > 0 && res.whiteX >= (redZone.minX - CFG.leadPx) && res.whiteX <= redZone.maxX) leadHit = true;
            if (vx < 0 && res.whiteX <= (redZone.maxX + CFG.leadPx) && res.whiteX >= redZone.minX) leadHit = true;
        }
        if (res.whiteX >= 0) prevWhiteX = res.whiteX;

        if (isDebugOpen) {
            updateDebugMetrics({
                scan: "แดง:" + redZone.minX + "-" + redZone.maxX + " | ขาว:" + (res.whiteX >= 0 ? res.whiteX : "-"),
                rgb: "RGB:" + res.centerRgb + " | แคป:" + (t1 - t0) + "ms สแกน:" + (t2 - t1) + "ms"
            }, false);
        }

        if (res.hitInRed || leadHit) {
            click(CFG.fishBtn.x, CFG.fishBtn.y);
            let tag = res.hitInRed ? ("ทับ X=" + res.hitX) : ("ดัก X=" + res.whiteX);
            addLog("⚡ กดตก! (" + tag + " " + (t1 - t0) + "+" + (t2 - t1) + "ms)");
            setStatus("⚡ กดจับปลาแล้ว!", "#22C55E", "รอบที่ " + roundNum + " / " + CFG.fishRounds);
            sleep(1800);
            return;
        }

        frameCnt++;
        if (frameCnt >= 12) {
            frameCnt = 0;
            if (!checkBarStillOpen(img, barState.rx, barState.rw, redZone.cy)) {
                closedCnt++;
                if (closedCnt >= 2) { addLog("แถบตกปลาปิดแล้ว"); sleep(900); return; }
            } else { closedCnt = 0; }
        }
    }
    addLog("หมดเวลา 10 วิ");
}

function storeItemsToVault() {
    setStatus("เปิดคลัง (5 วิ)...", "#C084FC", "กดค้าง ACCESS VAULT");
    addLog("กดเปิดคลังค้าง 5.2 วิ");
    press(CFG.vaultBtn.x, CFG.vaultBtn.y, CFG.vaultHoldTime);
    sleep(1500);

    let gapX = (CFG.bagBottomRight.x - CFG.bagTopLeft.x) / 3;
    let gapY = (CFG.bagBottomRight.y - CFG.bagTopLeft.y) / 3;
    let itemCount = 0;

    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
            if (!isRunning) return;
            itemCount++;
            setStatus("กำลังเก็บของเข้าคลัง", "#C084FC", "ช่องที่ " + itemCount + " / 16");
            swipe(Math.round(CFG.bagTopLeft.x + (col * gapX)), Math.round(CFG.bagTopLeft.y + (row * gapY)), CFG.vaultDrop.x, CFG.vaultDrop.y, 350);
            sleep(CFG.dragCooldown);
        }
    }

    setStatus("กลับเข้าเกม...", "#38BDF8", "กด RETURN TO GAME");
    addLog("เก็บครบ 16 ช่อง -> ปิดคลัง");
    click(CFG.returnBtn.x, CFG.returnBtn.y);
    sleep(1200);
}

setInterval(() => {}, 1000);