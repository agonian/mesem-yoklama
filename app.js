const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const app = express();
const port = 3000;

const DB_FILE = './data.json';
const YOKLAMA_FILE = './yoklamalar.json';

// --- AYARLAR ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Dosya Yükleme Ayarı (Excel için)
const upload = multer({ dest: 'uploads/' });

// --- YARDIMCI FONKSİYONLAR ---

// Dosya Okuma
const dosyaOku = (dosyaAdi) => {
    try {
        const data = fs.readFileSync(dosyaAdi, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return []; // Dosya yoksa boş liste dön
    }
};

// Dosya Yazma
const dosyaYaz = (dosyaAdi, data) => {
    fs.writeFileSync(dosyaAdi, JSON.stringify(data, null, 2));
};

// Telefon Numarası Formatlayıcı (+90 Standartlaştırıcı)
const telefonDuzelt = (tel) => {
    if (!tel) return "";
    let temiz = String(tel).replace(/[^0-9]/g, ''); // Sadece rakamları al
    
    // Eğer 10 hane girildiyse (532...) başına 90 ekle
    if (temiz.length === 10) return "90" + temiz;
    // Eğer 11 hane ve 0 ile başlıyorsa (0532...) 0'ı at, 90 ekle
    if (temiz.length === 11 && temiz.startsWith("0")) return "90" + temiz.substring(1);
    // Zaten 90 ile başlıyorsa dokunma
    if (temiz.startsWith("90")) return temiz;
    
    return "90" + temiz; // Bilinmeyen format, başına 90 koyup kaydedelim
};

// --- ROTALAR ---

// 1. ANASAYFA (Öğrenci Listesi)
app.get('/', (req, res) => {
    const ogrenciler = dosyaOku(DB_FILE);
    // Son eklenen en üstte olsun
    res.render('index', { ogrenciler: ogrenciler.reverse(), msg: req.query.msg });
});

// 2. EXCEL İLE TOPLU YÜKLEME
app.post('/toplu-yukle', upload.single('excelDosyasi'), async (req, res) => {
    if (!req.file) return res.send("Dosya yüklenemedi!");

    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        
        // Excel verisini JSON'a çevir
        const excelData = xlsx.utils.sheet_to_json(sheet);
        
        const mevcutListe = dosyaOku(DB_FILE);
        let eklenenSayisi = 0;

        for (const row of excelData) {
            // Gerekli alanlar kontrolü
            if (row.adSoyad && row.tcNo) {
                // QR Kod Oluştur
                const qrResim = await QRCode.toDataURL(String(row.tcNo));
                
                mevcutListe.push({
                    id: Date.now() + Math.random(), // Benzersiz ID
                    adSoyad: row.adSoyad,
                    tcNo: String(row.tcNo),
                    isletmeAdi: row.isletmeAdi || "-",
                    telefon: telefonDuzelt(row.telefon),
                    qrData: qrResim
                });
                eklenenSayisi++;
            }
        }

        dosyaYaz(DB_FILE, mevcutListe);
        fs.unlinkSync(req.file.path); // Geçici dosyayı sil

        res.redirect('/?msg=' + eklenenSayisi + ' öğrenci başarıyla eklendi.');
        
    } catch (err) {
        res.send("Hata: " + err.message);
    }
});

// 3. TEK ÖĞRENCİ EKLEME
app.post('/ogrenci-ekle', async (req, res) => {
    const { adSoyad, tcNo, isletmeAdi, telefon } = req.body;
    
    try {
        const qrResim = await QRCode.toDataURL(tcNo);
        
        const yeniOgrenci = {
            id: Date.now(),
            adSoyad,
            tcNo,
            isletmeAdi,
            telefon: telefonDuzelt(telefon),
            qrData: qrResim
        };
        
        const liste = dosyaOku(DB_FILE);
        liste.push(yeniOgrenci);
        dosyaYaz(DB_FILE, liste);
        
        res.redirect('/');
    } catch (err) { res.send("Hata: " + err.message); }
});

// 4. ÖĞRENCİ SİLME
app.get('/ogrenci-sil/:id', (req, res) => {
    const silinecekId = req.params.id;
    let ogrenciler = dosyaOku(DB_FILE);
    // ID'si eşleşmeyenleri tut (filtrele)
    const yeniListe = ogrenciler.filter(ogr => String(ogr.id) !== String(silinecekId));
    dosyaYaz(DB_FILE, yeniListe);
    res.redirect('/');
});

// 5. ÖĞRENCİ GÜNCELLEME
app.post('/ogrenci-guncelle', async (req, res) => {
    const { id, adSoyad, tcNo, isletmeAdi, telefon } = req.body;
    let ogrenciler = dosyaOku(DB_FILE);
    
    const index = ogrenciler.findIndex(ogr => String(ogr.id) === String(id));

    if (index !== -1) {
        // Eğer TC değiştiyse QR kodu yenile
        if (ogrenciler[index].tcNo !== tcNo) {
             ogrenciler[index].qrData = await QRCode.toDataURL(tcNo);
        }

        ogrenciler[index].adSoyad = adSoyad;
        ogrenciler[index].tcNo = tcNo;
        ogrenciler[index].isletmeAdi = isletmeAdi;
        ogrenciler[index].telefon = telefonDuzelt(telefon);

        dosyaYaz(DB_FILE, ogrenciler);
    }
    
    res.redirect('/');
});

// 6. YOKLAMA SAYFASI AÇMA
app.get('/yoklama-al', (req, res) => {
    const ogrenciler = dosyaOku(DB_FILE);
    // İsim sırasına göre sırala (Manuel seçim listesi için)
    ogrenciler.sort((a, b) => a.adSoyad.localeCompare(b.adSoyad));
    res.render('scan', { ogrenciler: ogrenciler });
});

// 7. YOKLAMA KAYDETME (API)
app.post('/yoklama-yap', (req, res) => {
    const { tcNo, durum, notlar, latitude, longitude } = req.body;
    
    const ogrenciler = dosyaOku(DB_FILE);
    // TC numarasından öğrenciyi bul
    const ogrenci = ogrenciler.find(o => String(o.tcNo) === String(tcNo));

    if (ogrenci) {
        // Harita linki oluştur
        const mapLink = latitude ? `https://www.google.com/maps?q=${latitude},${longitude}` : null;

        const yeniYoklama = {
            id: Date.now(),
            tarih: new Date().toLocaleString('tr-TR'),
            adSoyad: ogrenci.adSoyad,
            tcNo: ogrenci.tcNo, // Filtreleme için gerekli
            isletme: ogrenci.isletmeAdi,
            telefon: ogrenci.telefon,
            durum: durum,
            notlar: notlar,
            konum: mapLink
        };

        const yoklamalar = dosyaOku(YOKLAMA_FILE);
        yoklamalar.push(yeniYoklama);
        dosyaYaz(YOKLAMA_FILE, yoklamalar);

        res.json({ success: true, mesaj: `✅ ${ogrenci.adSoyad} sisteme işlendi!` });
    } else {
        res.json({ success: false, mesaj: "❌ Öğrenci Bulunamadı!" });
    }
});

// 8. RAPORLARI LİSTELEME (SİLİNEN ÖĞRENCİ FİLTRESİ DAHİL)
app.get('/raporlar', (req, res) => {
    let yoklamalar = dosyaOku(YOKLAMA_FILE);
    const ogrenciler = dosyaOku(DB_FILE); // Öğrencileri zaten okuyoruz

    // Aktif öğrencilerin TC listesini çıkar
    const aktifTCler = ogrenciler.map(ogr => String(ogr.tcNo));

    // Raporları filtrele
    const filtrelenmisRaporlar = yoklamalar.filter(rapor => {
        if (rapor.tcNo) {
            return aktifTCler.includes(String(rapor.tcNo));
        }
        return true; 
    });

    // --- DEĞİŞİKLİK BURADA ---
    // Header.ejs'nin hata vermemesi için 'ogrenciler' listesini de gönderiyoruz
    res.render('rapor', { 
        yoklamalar: filtrelenmisRaporlar.reverse(),
        ogrenciler: ogrenciler 
    });
});
// 9. RAPOR SİLME
app.get('/rapor-sil/:id', (req, res) => {
    const id = req.params.id;
    let yoklamalar = dosyaOku(YOKLAMA_FILE);
    const yeniListe = yoklamalar.filter(r => String(r.id) !== String(id));
    dosyaYaz(YOKLAMA_FILE, yeniListe);
    res.redirect('/raporlar');
});

// 10. RAPOR DÜZENLEME
app.post('/rapor-guncelle', (req, res) => {
    const { id, durum, isletme, notlar } = req.body;
    let yoklamalar = dosyaOku(YOKLAMA_FILE);
    const index = yoklamalar.findIndex(r => String(r.id) === String(id));

    if (index !== -1) {
        yoklamalar[index].durum = durum;
        yoklamalar[index].isletme = isletme;
        yoklamalar[index].notlar = notlar;
        dosyaYaz(YOKLAMA_FILE, yoklamalar);
    }
    res.redirect('/raporlar');
});

app.listen(port, () => {
    console.log(`-------------------------------------------`);
    console.log(`🚀 MESEM SİSTEMİ ÇALIŞIYOR: http://localhost:${port}`);
    console.log(`-------------------------------------------`);
});