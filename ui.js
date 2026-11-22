"auto";
const storage = storages.create("babyz_autofish_v2");

let CFG = storage.get("cfg", {
    rod: { x: 350, y: 650 },
    fishBtn: { x: 1030, y: 450 },
    barStart: { x: 380, y: 310 },
    barEnd: { x: 900, y: 390 },
    vaultBtn: { x: 640, y: 380 },
    bagTopLeft: { x: 160, y: 220 },
    bagBottomRight: { x: 450, y: 500 },
    vaultDrop: { x: 900, y: 350 },
    returnBtn: { x: 150, y: 650 },
    fishRounds: 10,
    vaultHoldTime: 5200,
    dragCooldown: 1000,
    rodMode: "manual",
    leadPx: 0
});

if (!CFG.fishRounds) CFG.fishRounds = 10;
if (!CFG.vaultHoldTime) CFG.vaultHoldTime = 5200;
if (!CFG.dragCooldown) CFG.dragCooldown = 1000;
if (!CFG.rodMode) CFG.rodMode = "manual";
if (CFG.leadPx === undefined) CFG.leadPx = 0;

function saveCfg() { storage.put("cfg", CFG); }

let isRunning = false, isTesting = false, isMinimized = false, isDebugOpen = false;
let botThread = null, testThread = null, hasCapturePerm = false;
let activePickers = [];
let debugLogs = [];
let pixelBuf = null, pixelBufLen = 0;

// พารามิเตอร์แปลงพิกัดหน้าจอ -> พิกัดภาพแคป (คำนวณจากคาลิเบรต 3 จุด)
let CAL = { ok: false, x0: 0, y0: 0, u0: 0, v0: 0, dudx: 1, dudy: 0, dvdx: 0, dvdy: 1, tag: "ยังไม่คาลิเบรต" };

function styleView(view, bgHex, radiusDp, strokeHex, strokePx) {
    try {
        let d = new android.graphics.drawable.GradientDrawable();
        d.setColor(colors.parseColor(bgHex));
        let density = context.getResources().getDisplayMetrics().density;
        d.setCornerRadius(radiusDp * density);
        if (strokeHex && strokePx) d.setStroke(strokePx, colors.parseColor(strokeHex));
        view.setBackground(d);
    } catch (e) {}
}

function getScreenInfo() {
    try {
        let dm = new android.util.DisplayMetrics();
        let disp = context.getSystemService(context.WINDOW_SERVICE).getDefaultDisplay();
        disp.getRealMetrics(dm);
        return { w: dm.widthPixels, h: dm.heightPixels, rot: disp.getRotation() };
    } catch (e) {
        return { w: device.height, h: device.width, rot: 1 };
    }
}

function getViewCenter(view, win) {
    try {
        let loc = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, 2);
        view.getLocationOnScreen(loc);
        return { x: Math.round(loc[0] + view.getWidth() / 2), y: Math.round(loc[1] + view.getHeight() / 2) };
    } catch (e) {
        return { x: Math.round(win.getX() + 22), y: Math.round(win.getY() + 22) };
    }
}

function getWindowOffset(win, rootView) {
    try {
        let loc = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, 2);
        rootView.getLocationOnScreen(loc);
        return { ox: loc[0] - win.getX(), oy: loc[1] - win.getY() };
    } catch (e) { return { ox: 0, oy: 0 }; }
}

function closeAllPickers() {
    let list = activePickers.slice();
    activePickers = [];
    setTimeout(() => {
        for (let i = 0; i < list.length; i++) { try { list[i].close(); } catch (e) {} }
    }, 50);
}

function createMaskPanel() {
    let w = floaty.rawWindow(<frame id="root" bg="#FF000000" w="*" h="*"/>);
    w.setTouchable(false); w.setPosition(0, 0); w.setSize(1, 1);
    return w;
}
let maskTop = createMaskPanel(), maskBot = createMaskPanel();
let maskLeft = createMaskPanel(), maskRight = createMaskPanel();
let maskOff = { ox: 0, oy: 0 };

function setMaskRect(win, x, y, w, h) {
    try {
        if (w <= 0 || h <= 0) {
            win.root.setVisibility(android.view.View.GONE);
            win.setSize(0, 0);
        } else {
            win.root.setVisibility(android.view.View.VISIBLE);
            win.setPosition(Math.round(x - maskOff.ox), Math.round(y - maskOff.oy));
            win.setSize(Math.round(w), Math.round(h));
        }
    } catch (e) {}
}

function hideBlackMask() {
    ui.run(() => {
        setMaskRect(maskTop, 0, 0, 0, 0);
        setMaskRect(maskBot, 0, 0, 0, 0);
        setMaskRect(maskLeft, 0, 0, 0, 0);
        setMaskRect(maskRight, 0, 0, 0, 0);
    });
}

function showBlackMask(scr) {
    let rx = Math.max(0, Math.min(CFG.barStart.x, CFG.barEnd.x));
    let ry = Math.max(0, Math.min(CFG.barStart.y, CFG.barEnd.y));
    let rw = Math.max(20, Math.abs(CFG.barEnd.x - CFG.barStart.x));
    let rh = Math.max(12, Math.abs(CFG.barEnd.y - CFG.barStart.y));
    let hx1 = Math.max(0, rx - 4), hy1 = Math.max(0, ry - 4);
    let hx2 = Math.min(scr.w, rx + rw + 4), hy2 = Math.min(scr.h, ry + rh + 4);
    let pad = 120;
    ui.run(() => {
        setMaskRect(maskTop, -pad, -pad, scr.w + pad * 2, hy1 + pad);
        setMaskRect(maskBot, -pad, hy2, scr.w + pad * 2, (scr.h - hy2) + pad);
        setMaskRect(maskLeft, -pad, hy1, hx1 + pad, hy2 - hy1);
        setMaskRect(maskRight, hx2, hy1, (scr.w - hx2) + pad, hy2 - hy1);
    });
}

setTimeout(() => { maskOff = getWindowOffset(maskTop, maskTop.root); hideBlackMask(); }, 150);

let mainWin = floaty.window(
    <vertical id="rootCard" padding="8" w="186">
        <horizontal id="headerBar" gravity="center_vertical" padding="6 4">
            <text id="titleTxt" text="⚡ AutoFish v4.3" textColor="#F8FAFC" textSize="12sp" textStyle="bold" layout_weight="1"/>
            <text id="btnMin" text=" − " textColor="#94A3B8" textSize="14sp" textStyle="bold" padding="4 1"/>
        </horizontal>
        <vertical id="statusCard" padding="6 5" marginTop="5">
            <text id="statusTxt" text="พร้อมทำงาน (v4.3)" textColor="#38BDF8" textSize="11sp" textStyle="bold" gravity="center"/>
            <text id="subTxt" text="คาลิเบรต 3 จุด + Turbo Strip" textColor="#94A3B8" textSize="9sp" gravity="center" marginTop="2"/>
        </vertical>
        <vertical id="bodyBox" marginTop="6">
            <horizontal>
                <text id="btnStart" text="▶ เริ่ม" textColor="#FFFFFF" textSize="11sp" textStyle="bold" gravity="center" h="34" layout_weight="1" marginRight="3"/>
                <text id="btnStop" text="⏸ หยุด" textColor="#FFFFFF" textSize="11sp" textStyle="bold" gravity="center" h="34" layout_weight="1" marginLeft="3"/>
            </horizontal>
            <horizontal marginTop="5">
                <text id="btnSetting" text="⚙ ตั้งจุด" textColor="#FFFFFF" textSize="11sp" textStyle="bold" gravity="center" h="34" layout_weight="1" marginRight="3"/>
                <text id="btnDebug" text="🐞 ดีบัก" textColor="#FFFFFF" textSize="11sp" textStyle="bold" gravity="center" h="34" layout_weight="1" marginLeft="3"/>
            </horizontal>
            <text id="btnClose" text="✖ ปิดโปรแกรม" textColor="#CBD5E1" textSize="10sp" textStyle="bold" gravity="center" h="28" marginTop="5"/>
        </vertical>
    </vertical>
);
mainWin.setPosition(30, 90);

ui.run(() => {
    styleView(mainWin.rootCard, "#EB0F172A", 14, "#38BDF8", 2);
    styleView(mainWin.headerBar, "#1E293B", 8, "#334155", 1);
    styleView(mainWin.btnMin, "#334155", 6);
    styleView(mainWin.statusCard, "#1E293B", 8, "#0F172A", 1);
    styleView(mainWin.btnStart, "#16A34A", 8);
    styleView(mainWin.btnStop, "#DC2626", 8);
    styleView(mainWin.btnSetting, "#2563EB", 8);
    styleView(mainWin.btnDebug, "#7C3AED", 8);
    styleView(mainWin.btnClose, "#334155", 8);
});

function bindWindowDrag(handleView, win) {
    let px = 0, py = 0, dx = 0, dy = 0;
    handleView.setOnTouchListener(function (view, event) {
        if (event.getAction() === event.ACTION_DOWN) { dx = event.getRawX(); dy = event.getRawY(); px = win.getX(); py = win.getY(); }
        else if (event.getAction() === event.ACTION_MOVE) { win.setPosition(Math.round(px + (event.getRawX() - dx)), Math.round(py + (event.getRawY() - dy))); }
        return true;
    });
}
bindWindowDrag(mainWin.titleTxt, mainWin);

mainWin.btnMin.click(() => {
    isMinimized = !isMinimized;
    ui.run(() => {
        mainWin.bodyBox.setVisibility(isMinimized ? android.view.View.GONE : android.view.View.VISIBLE);
        mainWin.btnMin.setText(isMinimized ? " + " : " − ");
    });
});

function setStatus(mainTxt, mainColor, subTxt) {
    ui.run(() => {
        mainWin.statusTxt.setText(mainTxt);
        mainWin.statusTxt.setTextColor(colors.parseColor(mainColor || "#F8FAFC"));
        if (subTxt !== undefined) mainWin.subTxt.setText(subTxt);
    });
}

let debugWin = floaty.window(
    <vertical id="dbgCard" padding="8" w="245">
        <horizontal id="dbgHead" gravity="center_vertical" padding="5 3">
            <text id="dbgTitle" text="🐞 Debug v4.3" textColor="#E9D5FF" textSize="11sp" textStyle="bold" layout_weight="1"/>
            <text id="dbgLiveBtn" text="สแกนสด" textColor="#FFFFFF" textSize="9sp" textStyle="bold" padding="6 3" marginRight="4"/>
            <text id="dbgHideBtn" text="✖" textColor="#CBD5E1" textSize="11sp" padding="5 2"/>
        </horizontal>
        <text id="dbgMeta" text="จอ:- | ภาพ:- | คาลิเบรต:-" textColor="#94A3B8" textSize="9sp" marginTop="4"/>
        <text id="dbgScan" text="ดำ:-% | แดง:- | ขาว:-" textColor="#FACC15" textSize="9sp" marginTop="2"/>
        <text id="dbgRgb" text="RGB:- | แคป:-ms สแกน:-ms" textColor="#38BDF8" textSize="9sp" marginTop="2"/>
        <text id="dbgLog" text="--- รอเริ่มทำงาน ---" textColor="#E2E8F0" textSize="9sp" marginTop="4" padding="5"/>
    </vertical>
);
debugWin.setPosition(230, 90);

ui.run(() => {
    styleView(debugWin.dbgCard, "#EB090D16", 12, "#7C3AED", 2);
    styleView(debugWin.dbgHead, "#1E1B4B", 6);
    styleView(debugWin.dbgLiveBtn, "#D97706", 6);
    styleView(debugWin.dbgHideBtn, "#334155", 6);
    styleView(debugWin.dbgLog, "#111827", 6, "#1F2937", 1);
    debugWin.dbgCard.setVisibility(android.view.View.GONE);
});
bindWindowDrag(debugWin.dbgTitle, debugWin);

function toggleDebugWin(forceState) {
    isDebugOpen = (forceState !== undefined) ? forceState : !isDebugOpen;
    ui.run(() => { debugWin.dbgCard.setVisibility(isDebugOpen ? android.view.View.VISIBLE : android.view.View.GONE); });
}

function addLog(msg) {
    let d = new Date();
    let p2 = (n) => (n < 10 ? "0" + n : "" + n);
    debugLogs.push("[" + p2(d.getMinutes()) + ":" + p2(d.getSeconds()) + "] " + msg);
    if (debugLogs.length > 5) debugLogs.shift();
    if (!isDebugOpen) return;
    let joined = debugLogs.join("\n");
    ui.run(() => { debugWin.dbgLog.setText(joined); });
}

let lastDbgUi = 0;
function updateDebugMetrics(info, force) {
    if (!isDebugOpen) return;
    let now = new Date().getTime();
    if (!force && (now - lastDbgUi < 130)) return;
    lastDbgUi = now;
    ui.run(() => {
        if (info.meta) debugWin.dbgMeta.setText(info.meta);
        if (info.scan) debugWin.dbgScan.setText(info.scan);
        if (info.rgb) debugWin.dbgRgb.setText(info.rgb);
    });
}

debugWin.dbgHideBtn.click(() => { isTesting = false; toggleDebugWin(false); });

debugWin.dbgLiveBtn.click(() => {
    if (isRunning) { toast("บอทกำลังรันอยู่ ดูค่าสดได้เลยครับ"); return; }
    if (isTesting) {
        isTesting = false;
        ui.run(() => debugWin.dbgLiveBtn.setText("สแกนสด"));
        addLog("หยุดสแกนสด");
        return;
    }
    isTesting = true; closeAllPickers(); hideBlackMask();
    ui.run(() => debugWin.dbgLiveBtn.setText("หยุดสแกน"));
    addLog("เริ่มสแกนสด (ปาเบ็ดเองเพื่อเช็ก)");

    testThread = threads.start(function () {
        try {
            let scr = getScreenInfo();
            if (!ensureCapture(scr)) { isTesting = false; return; }
            while (isTesting && !isRunning) {
                let t0 = new Date().getTime();
                let img = captureScreen();
                let t1 = new Date().getTime();
                let bar = findBarFast(img);
                let hitRes = null;
                if (bar.open && bar.redZone) {
                    hitRes = checkCatchFast(img, bar.redZone, bar.rx, bar.rw, Math.max(CFG.leadPx, 35), true);
                }
                let t2 = new Date().getTime();
                let rgbTxt = hitRes ? hitRes.centerRgb : bar.midRgb;

                updateDebugMetrics({
                    meta: "จอ:" + scr.w + "x" + scr.h + " ภาพ:" + img.getWidth() + "x" + img.getHeight() + " " + CAL.tag,
                    scan: "ดำ:" + bar.darkPct + "% | แดง:" + (bar.redZone ? (bar.redZone.minX + "-" + bar.redZone.maxX + " y" + bar.redZone.cy) : "ไม่เจอ") + " | ขาว:" + (hitRes && hitRes.whiteX >= 0 ? hitRes.whiteX : "-"),
                    rgb: "RGB:" + rgbTxt + " | แคป:" + (t1 - t0) + "ms สแกน:" + (t2 - t1) + "ms"
                }, false);

                if (hitRes && hitRes.hitInRed) setStatus("⚡ ทับแดงแล้ว!", "#22C55E", "ขาว X=" + hitRes.hitX);
                else if (bar.redZone) setStatus("เจอแดง รอขาว", "#FACC15", "สแกน " + (t2 - t1) + "ms");
                else setStatus("ยังไม่เจอแถบ", "#94A3B8", "ดำ " + bar.darkPct + "% | RGB:" + bar.midRgb);
                sleep(20);
            }
        } catch (e) { addLog("TestErr: " + e); }
        finally { isTesting = false; ui.run(() => debugWin.dbgLiveBtn.setText("สแกนสด")); }
    });
});

function openPointPicker(keyName, labelName) {
    closeAllPickers();
    toast("ลากเป้าไปวางที่: " + labelName + " แล้วกด ยืนยัน");
    let win = floaty.rawWindow(
        <vertical id="root" gravity="center">
            <text id="crosshair" text="+" textSize="26sp" textColor="#FFFFFF" w="42" h="42" gravity="center"/>
            <text id="btnConfirm" text="✔ ยืนยัน" textSize="10sp" textStyle="bold" textColor="#FFFFFF" padding="8 5" marginTop="3" gravity="center"/>
        </vertical>
    );
    activePickers.push(win);
    ui.run(() => {
        styleView(win.crosshair, "#AAEF4444", 21, "#FFFFFF", 2);
        styleView(win.btnConfirm, "#16A34A", 8, "#FFFFFF", 1);
    });
    win.setPosition(Math.round(CFG[keyName] ? Math.max(0, CFG[keyName].x - 30) : 300), Math.round(CFG[keyName] ? Math.max(0, CFG[keyName].y - 21) : 200));
    bindWindowDrag(win.crosshair, win);
    win.btnConfirm.click(() => {
        try {
            CFG[keyName] = getViewCenter(win.crosshair, win);
            saveCfg();
            toast("บันทึกแล้ว: " + labelName);
            addLog("ตั้งจุด " + labelName);
        } catch (err) { toast("Error: " + err); }
        finally { closeAllPickers(); }
    });
}

function openDualPointPicker(key1, key2, labelName) {
    closeAllPickers();
    let isBagGrid = (key1 === "bagTopLeft" && key2 === "bagBottomRight");
    toast(isBagGrid
        ? "ลาก +1 และ +2 กำหนดกรอบกระเป๋า ดูจุด 1-16 ให้ตรงกลางแต่ละช่อง แล้วกดยืนยัน"
        : "ลาก +1 (ซ้ายบน) และ +2 (ขวาล่าง) ให้กรอบเขียวทับพอดี แล้วกด ยืนยัน");

    let boxWin = floaty.rawWindow(
        <frame id="root" w="*" h="*">
            <text id="boxLabel" text="กรอบสแกน" textColor="#FFFFFF" textSize="9sp" gravity="center"/>
        </frame>
    );
    boxWin.setTouchable(false);
    boxWin.setPosition(0, 0);
    boxWin.setSize(40, 40);

    let win1 = floaty.rawWindow(
        <vertical gravity="center">
            <text id="crosshair" text="+1" textSize="14sp" textStyle="bold" textColor="#FFFFFF" w="40" h="40" gravity="center"/>
            <text id="btnCancel" text="ยกเลิก" textSize="9sp" textColor="#FFFFFF" padding="6 4" marginTop="3" gravity="center"/>
        </vertical>
    );
    let win2 = floaty.rawWindow(
        <vertical gravity="center">
            <text id="crosshair" text="+2" textSize="14sp" textStyle="bold" textColor="#FFFFFF" w="40" h="40" gravity="center"/>
            <text id="btnConfirm" text="✔ ยืนยัน" textSize="9sp" textStyle="bold" textColor="#FFFFFF" padding="6 4" marginTop="3" gravity="center"/>
        </vertical>
    );
    activePickers.push(boxWin, win1, win2);

    ui.run(() => {
        styleView(boxWin.root, "#4422C55E", 4, "#22C55E", 3);
        styleView(win1.crosshair, "#CCEF4444", 20, "#FFFFFF", 2);
        styleView(win1.btnCancel, "#475569", 6);
        styleView(win2.crosshair, "#CC0EA5E9", 20, "#FFFFFF", 2);
        styleView(win2.btnConfirm, "#16A34A", 6);
        if (isBagGrid) boxWin.boxLabel.setText("กระเป๋า 4x4 • จุดเก็บ 1-16");
    });

    let x1 = CFG[key1] ? Math.max(0, CFG[key1].x - 25) : 250;
    let y1 = CFG[key1] ? Math.max(0, CFG[key1].y - 20) : 200;
    let x2 = CFG[key2] ? Math.max(0, CFG[key2].x - 25) : 550;
    let y2 = CFG[key2] ? Math.max(0, CFG[key2].y - 20) : 260;
    if (Math.abs(x2 - x1) < 50 && Math.abs(y2 - y1) < 30) {
        x2 = x1 + 200;
        y2 = y1 + 45;
    }
    win1.setPosition(Math.round(x1), Math.round(y1));
    win2.setPosition(Math.round(x2), Math.round(y2));

    let boxOff = { ox: 0, oy: 0 };
    let gridMarkers = [];
    let markerOffsets = [];

    if (isBagGrid) {
        for (let i = 0; i < 16; i++) {
            let marker = floaty.rawWindow(
                <text id="dot" text={String(i + 1)} textColor="#FFFFFF" textSize="9sp" textStyle="bold" gravity="center" w="30" h="30"/>
            );
            marker.setTouchable(false);
            marker.setPosition(0, 0);
            gridMarkers.push(marker);
            activePickers.push(marker);
            ui.run(() => styleView(marker.dot, (i % 2 === 0) ? "#DD16A34A" : "#DD2563EB", 15, "#FFFFFF", 1));
        }
    }

    function updateBox() {
        try {
            let p1 = getViewCenter(win1.crosshair, win1);
            let p2 = getViewCenter(win2.crosshair, win2);
            let left = Math.min(p1.x, p2.x);
            let top = Math.min(p1.y, p2.y);
            boxWin.setPosition(Math.round(left - boxOff.ox), Math.round(top - boxOff.oy));
            boxWin.setSize(Math.max(12, Math.abs(p2.x - p1.x)), Math.max(12, Math.abs(p2.y - p1.y)));

            if (isBagGrid && markerOffsets.length === 16) {
                let stepX = (p2.x - p1.x) / 3;
                let stepY = (p2.y - p1.y) / 3;
                for (let row = 0; row < 4; row++) {
                    for (let col = 0; col < 4; col++) {
                        let index = row * 4 + col;
                        let px = p1.x + col * stepX;
                        let py = p1.y + row * stepY;
                        let off = markerOffsets[index];
                        gridMarkers[index].setPosition(
                            Math.round(px - off.ox - 15),
                            Math.round(py - off.oy - 15)
                        );
                    }
                }
            }
        } catch (e) {}
    }

    function dragUpdate(win) {
        let px = 0, py = 0, dx = 0, dy = 0;
        win.crosshair.setOnTouchListener(function (v, e) {
            if (e.getAction() === e.ACTION_DOWN) {
                dx = e.getRawX(); dy = e.getRawY();
                px = win.getX(); py = win.getY();
            } else if (e.getAction() === e.ACTION_MOVE) {
                win.setPosition(
                    Math.round(px + (e.getRawX() - dx)),
                    Math.round(py + (e.getRawY() - dy))
                );
                updateBox();
            }
            return true;
        });
    }
    dragUpdate(win1);
    dragUpdate(win2);

    setTimeout(() => {
        boxOff = getWindowOffset(boxWin, boxWin.root);
        if (isBagGrid) {
            markerOffsets = [];
            for (let i = 0; i < gridMarkers.length; i++) {
                markerOffsets.push(getWindowOffset(gridMarkers[i], gridMarkers[i].dot));
            }
        }
        updateBox();
    }, 180);

    win1.btnCancel.click(() => {
        toast("ยกเลิกการตั้งค่า");
        closeAllPickers();
    });
    win2.btnConfirm.click(() => {
        try {
            CFG[key1] = getViewCenter(win1.crosshair, win1);
            CFG[key2] = getViewCenter(win2.crosshair, win2);
            saveCfg();
            toast("บันทึกกรอบ " + labelName + " เรียบร้อย!");
            addLog("ตั้งกรอบ " + labelName);
        } catch (err) {
            toast("Error: " + err);
        } finally {
            closeAllPickers();
        }
    });
}
function previewScanBox() {
    let rx = Math.min(CFG.barStart.x, CFG.barEnd.x), ry = Math.min(CFG.barStart.y, CFG.barEnd.y);
    let rw = Math.max(20, Math.abs(CFG.barEnd.x - CFG.barStart.x)), rh = Math.max(15, Math.abs(CFG.barEnd.y - CFG.barStart.y));
    let boxWin = floaty.rawWindow(<frame id="root" w="*" h="*"><text text="กรอบสแกนจริง" textColor="#FFFFFF" textSize="9sp" gravity="center"/></frame>);
    boxWin.setTouchable(false); boxWin.setPosition(0, 0);
    ui.run(() => styleView(boxWin.root, "#4422C55E", 4, "#22C55E", 3));
    setTimeout(() => {
        let off = getWindowOffset(boxWin, boxWin.root);
        boxWin.setPosition(Math.round(rx - off.ox), Math.round(ry - off.oy));
        boxWin.setSize(rw, rh);
    }, 100);
    setTimeout(() => { try { boxWin.close(); } catch (e) {} }, 3500);
}

mainWin.btnSetting.click(() => {
    if (isRunning || isTesting) { toast("กรุณากดหยุดก่อนตั้งค่าครับ"); return; }
    hideBlackMask();
    let rodLabel = CFG.rodMode === "manual" ? "ถือเบ็ดเอง" : (CFG.rodMode === "always" ? "กดช่อง 3 เสมอ" : "เช็กปุ่มตก");
    let items = [
        "1. ช่องเบ็ดตกปลา (ช่อง 3)",
        "2. ปุ่มสีแดง 'ตก'",
        "3. แถบตกปลา (เลือก 2 จุดพร้อมกรอบ)",
        "4. ปุ่มเปิดคลัง (ACCESS VAULT)",
        "5. กระเป๋า 4x4 (เลือก 2 จุดพร้อมกรอบ)",
        "6. จุดวางของในคลัง (ฝั่งขวา)",
        "7. ปุ่ม RETURN TO GAME",
        "8. จำนวนรอบตกปลา (ตอนนี้ " + CFG.fishRounds + " รอบ)",
        "9. โหมดถือเบ็ดช่อง 3 (" + rodLabel + ")",
        "10. ระยะดักหน้าขีดขาว (ตอนนี้ " + CFG.leadPx + " px)",
        "🎯 คาลิเบรตหน้าจอใหม่",
        "🔍 ดูกรอบแถบตกปลาจริง (3.5 วิ)"
    ];
    dialogs.select("ตั้งค่า AutoFish v4.3", items, function (index) {
        switch (index) {
            case 0: openPointPicker("rod", "ช่องเบ็ดตกปลา"); break;
            case 1: openPointPicker("fishBtn", "ปุ่มสีแดง 'ตก'"); break;
            case 2: openDualPointPicker("barStart", "barEnd", "แถบตกปลา"); break;
            case 3: openPointPicker("vaultBtn", "ปุ่มเปิดคลัง"); break;
            case 4: openDualPointPicker("bagTopLeft", "bagBottomRight", "กระเป๋า 4x4"); break;
            case 5: openPointPicker("vaultDrop", "จุดวางของในคลัง"); break;
            case 6: openPointPicker("returnBtn", "ปุ่ม RETURN TO GAME"); break;
            case 7:
                dialogs.rawInput("จำนวนรอบตกปลาก่อนเปิดคลัง", String(CFG.fishRounds), function (v) {
                    let n = parseInt(v);
                    if (!isNaN(n) && n >= 1 && n <= 100) { CFG.fishRounds = n; saveCfg(); toast("ตั้งเป็น " + n + " รอบ"); }
                });
                break;
            case 8:
                dialogs.select("เลือกโหมดถือเบ็ดช่อง 3", ["ถือเบ็ดเอง (ไม่สแกนปุ่ม - แนะนำ)", "กดช่อง 3 ก่อนรอบ 1 เสมอ", "เช็กปุ่ม 'ตก' ก่อนปิดจอดำ"], function (m) {
                    if (m === 0) CFG.rodMode = "manual";
                    else if (m === 1) CFG.rodMode = "always";
                    else if (m === 2) CFG.rodMode = "check";
                    if (m >= 0) { saveCfg(); toast("บันทึกโหมดถือเบ็ดแล้ว"); }
                });
                break;
            case 9:
                dialogs.rawInput("ระยะดักหน้าขีดขาวเป็น px (0 = กดเมื่อทับแดง, 15-30 = กดล่วงหน้าแก้ดีเลย์)", String(CFG.leadPx), function (v) {
                    let n = parseInt(v);
                    if (!isNaN(n) && n >= 0 && n <= 80) { CFG.leadPx = n; saveCfg(); toast("ตั้งระยะดักหน้า " + n + " px"); }
                });
                break;
            case 10:
                CAL.ok = false;
                toast("จะคาลิเบรตหน้าจอใหม่ในรอบถัดไป");
                break;
            case 11: previewScanBox(); break;
        }
    });
});

