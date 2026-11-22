"auto";

// AutoFish stable bootstrap
// แก้ UI ที่ ui.js และระบบหลักที่ script.js
var BASE_URL = "https://raw.githubusercontent.com/ggezname/autofish/main/";

function downloadText(name) {
    var res = http.get(BASE_URL + name);
    if (!res || res.statusCode !== 200) {
        throw new Error("ดาวน์โหลด " + name + " ไม่สำเร็จ (HTTP " +
            (res ? res.statusCode : "ไม่มีการตอบกลับ") + ")");
    }
    var text = res.body.string();
    if (!text || text.length < 100) {
        throw new Error("ไฟล์ " + name + " ว่างหรือไม่สมบูรณ์");
    }
    return text;
}

try {
    toastLog("กำลังโหลด AutoFish จาก GitHub...");
    var uiCode = downloadText("ui.js");
    var coreCode = downloadText("script.js");

    // รวมสองส่วนใน scope เดียวกัน เพื่อให้ UI และระบบหลักเรียกใช้กันได้
    var fullCode = uiCode + "\n\n// ===== CORE SCRIPT =====\n" + coreCode;
    if (fullCode.length < 10000) {
        throw new Error("โค้ดที่รวมแล้วมีขนาดผิดปกติ");
    }

    toastLog("โหลดสำเร็จ กำลังเริ่ม AutoFish...");
    engines.execScript("AutoFish", fullCode);
} catch (e) {
    toastLog("AutoFish โหลดไม่สำเร็จ: " + e);
    log("AutoFish Bootstrap Error: " + e);
}
