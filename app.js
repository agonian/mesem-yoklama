require('dotenv').config(); // En tepeye ekle
const express = require('express');
const QRCode = require('qrcode');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs'); // Sadece Excel geçici dosyalarını silmek için kaldı
const path = require('path');
const session = require('express-session');
const admin = require('firebase-admin');
const ExcelJS = require('exceljs');

// --- SİSTEM YÖNETİCİSİ (MÜDÜR) E-POSTASI ---
const ADMIN_EMAIL = "yusuf.yilmz@gmail.com";

// --- FİREBASE BAŞLATMA ---
const serviceAccount = require('./firebase-key.json'); // İndirdiğin gizli anahtar
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Kopyaladığın Web API Anahtarı
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;

const app = express();
const port = 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const upload = multer({ dest: 'uploads/' });

// --- OTURUM (SESSION) AYARLARI ---
app.use(session({
    secret: 'mesem-super-gizli-anahtar-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// YARDIMCI FONKSİYON: Telefon Düzeltici
const telefonDuzelt = (tel) => {
    if (!tel) return "";
    let temiz = String(tel).replace(/[^0-9]/g, '');
    if (temiz.length === 10) return "90" + temiz;
    if (temiz.length === 11 && temiz.startsWith("0")) return "90" + temiz.substring(1);
    if (temiz.startsWith("90")) return temiz;
    return "90" + temiz;
};

// ==========================================
// 1. GİRİŞ VE ÇIKIŞ ROTALARI
// ==========================================
app.get('/login', (req, res) => {
    if(req.session.user) return res.redirect('/');
    res.render('login', { hata: req.query.hata });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        console.log("Giriş denemesi yapılıyor:", email); // Terminale yazdır
        
        const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, returnSecureToken: true })
        });
        
        const data = await response.json();

        if (data.idToken) {
            console.log("✅ Giriş Başarılı!");
            req.session.user = { email: data.email, uid: data.localId };
            res.redirect('/');
        } else {
            // Firebase'in gönderdiği gerçek hatayı görelim
            console.log("❌ Firebase Hatası:", data.error ? data.error.message : data);
            res.redirect('/login?hata=1');
        }
    } catch (err) {
        // Sistem hatası (Örn: fetch komutu bulunamadı)
        console.error("🚨 Sistem Hatası (Node.js):", err.message);
        res.redirect('/login?hata=1');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// ==========================================
// 2. GÜVENLİK DUVARI (Sadece giriş yapanlar)
// ==========================================
app.use((req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    res.locals.aktifKullanici = req.session.user.email;
    req.uid = req.session.user.uid; // Öğretmen ID'sini her yerde kullanmak için kısayol
    next();
});

// ==========================================
// 3. UYGULAMA ROTALARI (FIRESTORE ENTEGRELİ)
// ==========================================

// ==========================================
// 1. GÜNCELLENEN ANASAYFA (İŞLETME LİSTELEME)
// ==========================================
app.get('/', async (req, res) => {
    try {
        // Öğretmenin tüm öğrencilerini çek
        const snapshot = await db.collection('ogrenciler').where('ogretmenId', '==', req.uid).get();
        const ogrenciler = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // ÖĞRENCİLERİ İŞLETMELERE GÖRE GRUPLA
        let isletmeGruplari = {};
        
        ogrenciler.forEach(ogr => {
            let isletmeAdi = ogr.isletmeAdi || "Belirsiz İşletme";
            if (!isletmeGruplari[isletmeAdi]) {
                isletmeGruplari[isletmeAdi] = {
                    ad: isletmeAdi,
                    ogrenciSayisi: 0,
                    adres: ogr.isyeriAdresi || "Adres Girilmemiş", // Excel'den gelen adres
                    telefon: ogr.isyeriTel || "",
                    ogrenciler: []
                };
            }
            isletmeGruplari[isletmeAdi].ogrenciler.push(ogr);
            isletmeGruplari[isletmeAdi].ogrenciSayisi++;
        });

        // İşletme adlarına göre alfabetik sırala
        const siraliIsletmeler = Object.values(isletmeGruplari).sort((a, b) => a.ad.localeCompare(b.ad));

        res.render('index', { isletmeler: siraliIsletmeler, msg: req.query.msg });
    } catch (error) { res.send("Veritabanı hatası: " + error.message); }
});


// ==========================================
// 2. YENİ YOKLAMA EKRANI (İŞLETME DETAY)
// ==========================================
app.get('/isletme-yoklama/:isletmeAdi', async (req, res) => {
    try {
        const isletmeAdi = req.params.isletmeAdi;
        // Sadece o işletmenin ve o öğretmenin öğrencilerini getir
        const snapshot = await db.collection('ogrenciler')
            .where('ogretmenId', '==', req.uid)
            .where('isletmeAdi', '==', isletmeAdi)
            .get();
            
        const ogrenciler = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        ogrenciler.sort((a, b) => a.adSoyad.localeCompare(b.adSoyad));

        res.render('yoklama-detay', { isletmeAdi, ogrenciler });
    } catch (error) { res.send("Hata: " + error.message); }
});


// ==========================================
// A. YOKLAMA KAYDETME (TARİH SEÇİMLİ)
// ==========================================
app.post('/isletme-yoklama-kaydet', async (req, res) => {
    // secilenTarih parametresini alıyoruz
    const { isletmeAdi, yoklamalar, latitude, longitude, secilenTarih } = req.body; 

    const batch = db.batch();
    
    // Tarih formatını ayarla (2026-02-18 -> 18.02.2026 çevrimi)
    let kayitTarihi;
    if (secilenTarih) {
        const [yil, ay, gun] = secilenTarih.split('-');
        kayitTarihi = `${gun}.${ay}.${yil}`;
    } else {
        kayitTarihi = new Date().toLocaleString('tr-TR').split(' ')[0];
    }

    const mapLink = latitude ? `https://www.google.com/maps?q=$${latitude},${longitude}` : null;

    yoklamalar.forEach(veri => {
        const yeniDoc = db.collection('yoklamalar').doc();
        batch.set(yeniDoc, {
            ogretmenId: req.uid,
            tarih: kayitTarihi, // Artık seçilen tarih kaydediliyor
            adSoyad: veri.adSoyad,
            tcNo: veri.tcNo,
            isletme: isletmeAdi,
            durum: veri.durum, 
            notlar: veri.not || "",
            konum: mapLink,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    });

    await batch.commit();
    res.json({ success: true, mesaj: "Yoklamalar seçilen tarihe kaydedildi." });
});


// TEK ÖĞRENCİ EKLE
app.post('/ogrenci-ekle', async (req, res) => {
    const { adSoyad, tcNo, isletmeAdi, telefon } = req.body;
    const qrResim = await QRCode.toDataURL(tcNo);
    
    await db.collection('ogrenciler').add({
        ogretmenId: req.uid, // Hangi öğretmenin eklediğini damgalıyoruz!
        adSoyad, tcNo, isletmeAdi, 
        telefon: telefonDuzelt(telefon),
        qrData: qrResim,
        eklenmeTarihi: admin.firestore.FieldValue.serverTimestamp()
    });
    res.redirect('/?msg=Öğrenci başarıyla eklendi.');
});

// EXCEL İLE ÖĞRENCİ YÜKLE
app.post('/toplu-yukle', upload.single('excelDosyasi'), async (req, res) => {
    if (!req.file) return res.redirect('/?msg=Dosya bulunamadı.');
    try {
        const workbook = xlsx.readFile(req.file.path);
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        let eklenen = 0;
        
        const batch = db.batch(); // Toplu yazma işlemi (daha hızlı)
        for (const row of data) {
            if (row.adSoyad && row.tcNo) {
                const qrResim = await QRCode.toDataURL(String(row.tcNo));
                const yeniDoc = db.collection('ogrenciler').doc(); // Yeni boş belge oluştur
                batch.set(yeniDoc, {
                    ogretmenId: req.uid,
                    adSoyad: row.adSoyad,
                    tcNo: String(row.tcNo),
                    isletmeAdi: row.isletmeAdi || "-",
                    telefon: telefonDuzelt(row.telefon),
                    qrData: qrResim
                });
                eklenen++;
            }
        }
        await batch.commit(); // Hepsini tek seferde veritabanına yaz
        fs.unlinkSync(req.file.path); // Geçici Excel'i sil
        res.redirect(`/?msg=${eklenen} öğrenci eklendi.`);
    } catch (err) { res.send("Hata: " + err.message); }
});

// ÖĞRENCİ SİL
app.get('/ogrenci-sil/:id', async (req, res) => {
    await db.collection('ogrenciler').doc(req.params.id).delete();
    res.redirect('/?msg=Öğrenci silindi.');
});

// ÖĞRENCİ GÜNCELLE
app.post('/ogrenci-guncelle', async (req, res) => {
    const { id, adSoyad, tcNo, isletmeAdi, telefon } = req.body;
    
    // Önce eski veriyi çek (TC değişmişse QR'ı yenilemek için)
    const docRef = db.collection('ogrenciler').doc(id);
    const docSnap = await docRef.get();
    
    let updateData = { adSoyad, tcNo, isletmeAdi, telefon: telefonDuzelt(telefon) };
    
    if (docSnap.exists && docSnap.data().tcNo !== tcNo) {
        updateData.qrData = await QRCode.toDataURL(tcNo);
    }
    await docRef.update(updateData);
    res.redirect('/?msg=Öğrenci güncellendi.');
});

// ==========================================
// YOKLAMA VE RAPOR ROTALARI
// ==========================================
app.get('/yoklama-al', async (req, res) => {
    const snapshot = await db.collection('ogrenciler').where('ogretmenId', '==', req.uid).get();
    const ogrenciler = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    ogrenciler.sort((a, b) => a.adSoyad.localeCompare(b.adSoyad));
    res.render('scan', { ogrenciler });
});

app.post('/yoklama-yap', async (req, res) => {
    const { tcNo, durum, notlar, latitude, longitude } = req.body;
    
    // Öğrenciyi TC No ve Öğretmen ID ile bul
    const ogrSnap = await db.collection('ogrenciler').where('ogretmenId', '==', req.uid).where('tcNo', '==', String(tcNo)).get();
    
    if (!ogrSnap.empty) {
        const ogrenci = ogrSnap.docs[0].data();
        const mapLink = latitude ? `https://www.google.com/maps?q=$${latitude},${longitude}` : null;
        
        await db.collection('yoklamalar').add({
            ogretmenId: req.uid,
            tarih: new Date().toLocaleString('tr-TR'),
            adSoyad: ogrenci.adSoyad,
            tcNo: ogrenci.tcNo,
            isletme: ogrenci.isletmeAdi,
            telefon: ogrenci.telefon,
            durum: durum,
            notlar: notlar,
            konum: mapLink,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        res.json({ success: true, mesaj: `✅ ${ogrenci.adSoyad} sisteme işlendi!` });
    } else {
        res.json({ success: false, mesaj: "❌ Öğrenci Bulunamadı!" });
    }
});

// ==========================================
// 1. RAPORLAR SAYFASI (GRUPLANDIRILMIŞ)
// ==========================================
app.get('/raporlar', async (req, res) => {
    try {
        // Öğretmenin tüm yoklamalarını çek
        const snapshot = await db.collection('yoklamalar')
            .where('ogretmenId', '==', req.uid)
            .orderBy('timestamp', 'desc') // En yeniden eskiye
            .get();

        const hamVeri = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // VERİLERİ GRUPLA (Aynı Tarih ve Aynı İşletme olanları birleştir)
        let gruplanmisRaporlar = {};

        hamVeri.forEach(veri => {
            // Benzersiz Grup Anahtarı: "İşletmeAdı_TarihStringi"
            // Tarih stringini dosya adı gibi güvenli hale getiriyoruz ki linklerde sorun çıkmasın
            const grupKey = `${veri.isletme}|${veri.tarih}`;

            if (!gruplanmisRaporlar[grupKey]) {
                gruplanmisRaporlar[grupKey] = {
                    isletme: veri.isletme,
                    tarih: veri.tarih,
                    ogrenciSayisi: 0,
                    kayitIds: [], // Bu grubun içindeki tüm belge ID'leri
                    orijinalTarih: veri.tarih // Sorgu için saklıyoruz
                };
            }
            gruplanmisRaporlar[grupKey].ogrenciSayisi++;
            gruplanmisRaporlar[grupKey].kayitIds.push(veri.id);
        });

        // Objeyi Diziye Çevir ve Sırala
        const raporListesi = Object.values(gruplanmisRaporlar);

        res.render('rapor', { raporlar: raporListesi, msg: req.query.msg });

    } catch (error) {
        console.error(error);
        res.send("Raporlar yüklenirken hata oluştu: " + error.message);
    }
});

// ==========================================
// 2. RAPOR SİL (GRUP OLARAK SİLME)
// ==========================================
app.get('/rapor-sil-grup', async (req, res) => {
    const { isletme, tarih } = req.query;
    try {
        // O işletme ve o tarihe ait tüm kayıtları bul
        const snapshot = await db.collection('yoklamalar')
            .where('ogretmenId', '==', req.uid)
            .where('isletme', '==', isletme)
            .where('tarih', '==', tarih)
            .get();

        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        res.redirect('/raporlar?msg=Yoklama grubu tamamen silindi.');
    } catch (err) {
        res.redirect('/raporlar?msg=Hata: ' + err.message);
    }
});






// ==========================================
// 3. RAPOR DÜZENLEME EKRANI (GET)
// ==========================================
app.get('/rapor-duzenle', async (req, res) => {
    const { isletme, tarih } = req.query;
    try {
        // 1. O işletmeye ait TÜM öğrencileri çek (Listede olmayanları da görelim ki ekleyebilelim)
        const ogrSnap = await db.collection('ogrenciler')
            .where('ogretmenId', '==', req.uid)
            .where('isletmeAdi', '==', isletme)
            .get();
        
        let tumOgrenciler = ogrSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        tumOgrenciler.sort((a, b) => a.adSoyad.localeCompare(b.adSoyad));

        // 2. Mevcut Yoklamayı Çek
        const yoklamaSnap = await db.collection('yoklamalar')
            .where('ogretmenId', '==', req.uid)
            .where('isletme', '==', isletme)
            .where('tarih', '==', tarih)
            .get();

        const mevcutYoklama = {};
        yoklamaSnap.docs.forEach(doc => {
            const data = doc.data();
            mevcutYoklama[data.tcNo] = {
                durum: data.durum,
                notlar: data.notlar
            };
        });

        // 3. Öğrenci listesi ile Mevcut Yoklamayı Birleştir
        const birlestirilmisListe = tumOgrenciler.map(ogr => {
            const kayit = mevcutYoklama[ogr.tcNo];
            return {
                ...ogr,
                gecmisDurum: kayit ? kayit.durum : null, // Daha önce ne seçilmiş?
                gecmisNot: kayit ? kayit.notlar : ""
            };
        });

        res.render('rapor-duzenle', { 
            isletmeAdi: isletme, 
            tarih: tarih, 
            ogrenciler: birlestirilmisListe 
        });

    } catch (err) {
        res.send("Hata: " + err.message);
    }
});

// ==========================================
// 4. RAPOR GÜNCELLEME İŞLEMİ (POST)
// ==========================================
app.post('/rapor-guncelle', async (req, res) => {
    const { isletmeAdi, tarih, yoklamalar } = req.body;
    
    try {
        const batch = db.batch();

        // ADIM 1: Eski kayıtları temizle (En güvenli güncelleme yöntemi silip tekrar yazmaktır)
        const eskiSnap = await db.collection('yoklamalar')
            .where('ogretmenId', '==', req.uid)
            .where('isletme', '==', isletmeAdi)
            .where('tarih', '==', tarih)
            .get();
        
        eskiSnap.docs.forEach(doc => batch.delete(doc.ref));

        // ADIM 2: Yeni listeyi ekle (Tarih aynı kalsın ki geçmiş bozulmasın)
        // Not: Eğer timestamp güncellensin istersen buraya yeni tarih atabiliriz ama
        // "Düzenleme" olduğu için eski tarihin kalması daha doğru olur.
        
        yoklamalar.forEach(veri => {
            const yeniDoc = db.collection('yoklamalar').doc();
            batch.set(yeniDoc, {
                ogretmenId: req.uid,
                tarih: tarih, // Eski tarihi koruyoruz!
                adSoyad: veri.adSoyad,
                tcNo: veri.tcNo,
                isletme: isletmeAdi,
                durum: veri.durum,
                notlar: veri.not || "",
                timestamp: admin.firestore.FieldValue.serverTimestamp() // Sıralama için güncel zaman
            });
        });

        await batch.commit();
        res.json({ success: true, mesaj: "Yoklama başarıyla güncellendi." });

    } catch (err) {
        res.json({ success: false, mesaj: "Hata: " + err.message });
    }
});
// ==========================================
// ÖDEMELER VE İŞLETMELER
// ==========================================
app.get('/odemeler', async (req, res) => {
    const [isletmeSnap, ogrSnap] = await Promise.all([
        db.collection('isletmeler').where('ogretmenId', '==', req.uid).get(),
        db.collection('ogrenciler').where('ogretmenId', '==', req.uid).get()
    ]);

    const isletmeler = isletmeSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const ogrenciler = ogrSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    isletmeler.sort((a, b) => a.isletmeAdi.localeCompare(b.isletmeAdi));

    res.render('odemeler', { isletmeler, odemeListesi: null, msg: req.query.msg, ogrenciler });
});

app.post('/isletme-yukle', upload.single('excelDosyasi'), async (req, res) => {
    if (!req.file) return res.redirect('/odemeler?msg=Dosya bulunamadı');
    try {
        const data = xlsx.utils.sheet_to_json(xlsx.readFile(req.file.path).Sheets[xlsx.readFile(req.file.path).SheetNames[0]]);
        
        // Mevcut işletmeleri kontrol etmek için çek
        const mevcutSnap = await db.collection('isletmeler').where('ogretmenId', '==', req.uid).get();
        const mevcutIsimler = mevcutSnap.docs.map(doc => doc.data().isletmeAdi);
        
        let eklenen = 0;
        const batch = db.batch();

        for (const row of data) {
            if (row.isletmeAdi && row.telefon) {
                const isim = row.isletmeAdi.trim();
                if (!mevcutIsimler.includes(isim)) {
                    const yeniDoc = db.collection('isletmeler').doc();
                    batch.set(yeniDoc, {
                        ogretmenId: req.uid,
                        isletmeAdi: isim,
                        telefon: telefonDuzelt(row.telefon)
                    });
                    mevcutIsimler.push(isim);
                    eklenen++;
                }
            }
        }
        await batch.commit();
        fs.unlinkSync(req.file.path);
        res.redirect(`/odemeler?msg=${eklenen} yeni işletme eklendi.`);
    } catch (err) { res.send("Hata: " + err.message); }
});

app.post('/isletme-guncelle', async (req, res) => {
    const { id, isletmeAdi, telefon } = req.body;
    await db.collection('isletmeler').doc(id).update({
        isletmeAdi: isletmeAdi.trim(),
        telefon: telefonDuzelt(telefon)
    });
    res.redirect('/odemeler?msg=İşletme güncellendi.');
});

app.get('/isletme-sil/:id', async (req, res) => {
    await db.collection('isletmeler').doc(req.params.id).delete();
    res.redirect('/odemeler?msg=İşletme silindi.');
});

app.post('/odeme-listesi-yukle', upload.single('excelDosyasi'), async (req, res) => {
    if (!req.file) return res.send("Dosya yok!");
    try {
        const [isletmeSnap, ogrSnap] = await Promise.all([
            db.collection('isletmeler').where('ogretmenId', '==', req.uid).get(),
            db.collection('ogrenciler').where('ogretmenId', '==', req.uid).get()
        ]);
        const rehber = isletmeSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const ogrenciler = ogrSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        const hamVeri = xlsx.utils.sheet_to_json(xlsx.readFile(req.file.path).Sheets[xlsx.readFile(req.file.path).SheetNames[0]]);
        let gruplanmisVeri = {}; 

        hamVeri.forEach(row => {
            if(!row.isletmeAdi) return;
            const isletmeAdi = row.isletmeAdi.trim();
            
            if (!gruplanmisVeri[isletmeAdi]) {
                const iletisim = rehber.find(r => r.isletmeAdi.toLowerCase() === isletmeAdi.toLowerCase());
                gruplanmisVeri[isletmeAdi] = {
                    id: iletisim ? iletisim.id : null, 
                    telefon: iletisim ? iletisim.telefon : null,
                    ogrenciler: [],
                    toplamTutar: 0
                };
            }

            let hamUcret = parseFloat(row.ucret) || 0;
            let islemUcreti = Math.ceil(hamUcret);

            if (row.ogrenciAdi && row.ogrenciAdi.toLowerCase().includes('örgün')) {
                islemUcreti = islemUcreti * 1.5;
            }

            let sonUcret = Math.ceil(islemUcreti);
            gruplanmisVeri[isletmeAdi].ogrenciler.push({ ad: row.ogrenciAdi, ucret: sonUcret });
            gruplanmisVeri[isletmeAdi].toplamTutar += sonUcret;
        });

        fs.unlinkSync(req.file.path);
        res.render('odemeler', { 
            isletmeler: rehber, 
            odemeListesi: gruplanmisVeri,
            msg: "Ödemeler hesaplandı.",
            ogrenciler: ogrenciler 
        });

    } catch (err) { res.send("Hata: " + err.message); }
});


// ==========================================
// AJAX: TARİHE GÖRE YOKLAMA BİLGİSİ GETİR
// ==========================================
app.get('/get-yoklama-durumu', async (req, res) => {
    const { isletmeAdi, tarih } = req.query; // Örn: 2026-02-18 formatında gelir

    try {
        // Tarihi veritabanı formatına (DD.MM.YYYY) çevir
        const [yil, ay, gun] = tarih.split('-');
        const dbTarih = `${gun}.${ay}.${yil}`;

        // Sorgu at
        const snapshot = await db.collection('yoklamalar')
            .where('ogretmenId', '==', req.uid)
            .where('isletme', '==', isletmeAdi)
            .where('tarih', '==', dbTarih)
            .get();

        // Gelen veriyi basit bir objeye çevir: { "12345678901": { durum: "❌ Devamsız", not: "..." } }
        let kayitlar = {};
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            kayitlar[data.tcNo] = {
                durum: data.durum,
                not: data.notlar
            };
        });

        res.json({ success: true, kayitlar: kayitlar });

    } catch (err) {
        res.json({ success: false, mesaj: err.message });
    }
});


// ==========================================
// 4. ADMİN (MÜDÜR) PANELİ ROTALARI
// ==========================================

const adminSorgusu = (req, res, next) => {
    if (req.session.user.email !== ADMIN_EMAIL) {
        return res.redirect('/?msg=Bu sayfaya sadece müdür girebilir!');
    }
    next();
};

// Admin Paneli Anasayfası
app.get('/admin', adminSorgusu, async (req, res) => {
    try {
        // Öğretmen şifrelerini veritabanından çek (Müdür görebilsin diye)
        const sifreSnap = await db.collection('ogretmen_sifreleri').get();
        let sifreler = {};
        sifreSnap.forEach(doc => { sifreler[doc.data().email] = doc.data().password; });

        const listUsersResult = await admin.auth().listUsers(1000);
        const ogretmenler = listUsersResult.users.filter(u => u.email !== ADMIN_EMAIL).map(u => ({
            uid: u.uid,
            email: u.email,
            isim: u.displayName || "İsimsiz",
            sifre: sifreler[u.email] || "Bilinmiyor (Eski)" // Şifreyi tabloya gönder
        }));

        res.render('admin', { ogretmenler, msg: req.query.msg });
    } catch (error) { res.send("Hata: " + error.message); }
});

// Manuel Öğretmen Ekleme
app.post('/admin/ogretmen-ekle', adminSorgusu, async (req, res) => {
    const { email, password, isim } = req.body;
    try {
        await admin.auth().createUser({ email, password, displayName: isim });
        // Müdür sonradan görebilsin diye şifreyi kaydet
        await db.collection('ogretmen_sifreleri').add({ email, password, isim }); 
        res.redirect('/admin?msg=Yeni öğretmen hesabı başarıyla oluşturuldu.');
    } catch (error) { res.redirect('/admin?msg=Hata: ' + error.message); }
});

// ==========================================
// 4. GÜNCELLENEN EXCEL IMPORT (TÜM SÜTUNLAR)
// ==========================================
app.post('/admin/meb-excel-yukle', adminSorgusu, upload.single('excelDosyasi'), async (req, res) => {
    if (!req.file) return res.redirect('/admin?msg=Dosya bulunamadı.');

    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = xlsx.utils.sheet_to_json(sheet);

        let eklenenOgrenci = 0;
        let eklenenOgretmen = 0;
        const batch = db.batch();

        let ogretmenCache = {}; 
        const listUsersResult = await admin.auth().listUsers(1000);
        const existingUsers = listUsersResult.users;

        for (const row of data) {
            // Excel Sütun Eşleştirme (Fotoğraftaki başlıklara göre)
            let getVal = (keyStr) => {
                let key = Object.keys(row).find(k => k.toLowerCase().includes(keyStr.toLowerCase()));
                return key ? row[key] : null;
            };

            const ogretmenAdi = getVal('Öğretmen');
            const adSoyad = getVal('Ad Soyad');
            const tcNo = getVal('T.C'); 
            const isletmeAdi = getVal('İşletme');
            
            // --- YENİ EKLENEN ALANLAR ---
            const telefon = getVal('Öğrenci Tel');
            const isyeriTel = getVal('İşyeri Tel');
            const isyeriAdresi = getVal('İşyeri Adresi');
            const ustaOgretici = getVal('Usta Öğretici');
            const iseGiris = getVal('İşe Giriş');
            const dal = getVal('Dal');
            // ---------------------------

            if (!ogretmenAdi || !adSoyad) continue;

            let ogretmenUid = ogretmenCache[ogretmenAdi];

            if (!ogretmenUid) {
                // Öğretmen hesabı oluşturma mantığı (Aynı kalıyor)
                const trMap = {'ç':'c','ğ':'g','ş':'s','ü':'u','ı':'i','ö':'o','Ç':'c','Ğ':'g','Ş':'s','Ü':'u','İ':'i','Ö':'o', ' ':'_'};
                let temizIsim = ogretmenAdi.replace(/[çğşüıöÇĞŞÜİÖ ]/g, m => trMap[m]).replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
                let email = `${temizIsim}@okul.com`;
                let existingUser = existingUsers.find(u => u.email === email);
                
                if (existingUser) {
                    ogretmenUid = existingUser.uid;
                } else {
                    // Şifre oluşturma kısmı... (Burayı kısa kestim, önceki kodun aynısı)
                    let password = "123456"; // Basitlik olsun diye test şifresi
                    const newUser = await admin.auth().createUser({ email, password, displayName: ogretmenAdi });
                    ogretmenUid = newUser.uid;
                    await db.collection('ogretmen_sifreleri').add({ email, password, isim: ogretmenAdi });
                    existingUsers.push(newUser);
                    eklenenOgretmen++;
                }
                ogretmenCache[ogretmenAdi] = ogretmenUid;
            }

            // ÖĞRENCİYİ DETAYLI KAYDET
            const yeniDoc = db.collection('ogrenciler').doc();
            batch.set(yeniDoc, {
                ogretmenId: ogretmenUid,
                adSoyad: String(adSoyad),
                tcNo: String(tcNo),
                isletmeAdi: isletmeAdi || "-",
                telefon: telefonDuzelt(telefon),
                isyeriTel: telefonDuzelt(isyeriTel), // YENİ
                isyeriAdresi: isyeriAdresi || "",    // YENİ
                ustaOgretici: ustaOgretici || "",    // YENİ
                iseGirisTarihi: iseGiris || "",      // YENİ
                alanDal: dal || "",                  // YENİ
                eklenmeTarihi: admin.firestore.FieldValue.serverTimestamp()
            });
            eklenenOgrenci++;
        }

        await batch.commit();
        fs.unlinkSync(req.file.path);
        res.redirect(`/admin?msg=${eklenenOgretmen} öğretmen ve ${eklenenOgrenci} öğrenci detaylarıyla yüklendi.`);

    } catch (err) { res.redirect('/admin?msg=Hata: ' + err.message); }
});


// ==========================================
// ADMİN: VERİTABANI SIFIRLAMA (Öğrenci ve Yoklamaları Siler)
// ==========================================
app.post('/admin/sifirla', adminSorgusu, async (req, res) => {
    try {
        const batch = db.batch();

        // 1. Tüm Öğrencileri Seç ve Silme Listesine Ekle
        const ogrSnap = await db.collection('ogrenciler').get();
        ogrSnap.docs.forEach(doc => batch.delete(doc.ref));

        // 2. Tüm Yoklamaları Seç ve Silme Listesine Ekle
        const yoklamaSnap = await db.collection('yoklamalar').get();
        yoklamaSnap.docs.forEach(doc => batch.delete(doc.ref));
        
        // 3. İşlemi Uygula
        await batch.commit();
        
        res.redirect('/admin?msg=Veritabanı başarıyla temizlendi (Öğretmen hesapları korundu).');
    } catch (err) {
        res.redirect('/admin?msg=Hata: ' + err.message);
    }
});




// ==========================================
// B. EXCEL İNDİRME (SİYAH RENK + FULL ARTI)
// ==========================================
app.get('/rapor-indir', async (req, res) => {
    const { isletmeAdi, ay, yil } = req.query;

    try {
        console.log(`Excel isteği: ${isletmeAdi} - ${ay}/${yil}`);

        // 1. ÖĞRENCİLER
        const ogrSnap = await db.collection('ogrenciler')
            .where('ogretmenId', '==', req.uid)
            .where('isletmeAdi', '==', isletmeAdi)
            .get();
        
        let ogrenciler = ogrSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        ogrenciler.sort((a, b) => a.adSoyad.localeCompare(b.adSoyad));

        // 2. YOKLAMALAR
        const arananAyStr = `.${String(ay).padStart(2, '0')}.${yil}`;
        const yoklamaSnap = await db.collection('yoklamalar')
            .where('ogretmenId', '==', req.uid)
            .where('isletme', '==', isletmeAdi)
            .get();

        const oAyinYoklamalari = yoklamaSnap.docs
            .map(doc => doc.data())
            .filter(y => y.tarih.includes(arananAyStr));

        // 3. EXCEL HAZIRLIK
        const workbook = new ExcelJS.Workbook();
        const sablonYolu = path.join(__dirname, 'public', 'sablon.xlsx');
        await workbook.xlsx.readFile(sablonYolu);
        const worksheet = workbook.getWorksheet(1);

        worksheet.getCell('F5').value = isletmeAdi; 
        worksheet.getCell('AG5').value = `${String(ay).padStart(2, '0')} / ${yil}`;

        // 4. DOLDURMA
        let satirNo = 9; 

        ogrenciler.forEach((ogr, index) => {
     
            worksheet.getCell(`C${satirNo}`).value = ogr.adSoyad; 
            
            const daysInMonth = new Date(yil, ay, 0).getDate();

            for (let gun = 1; gun <= daysInMonth; gun++) {
                let currentDate = new Date(yil, ay - 1, gun);
                let dayOfWeek = currentDate.getDay(); // 0:Pazar, 6:Ctesi
                
                if (dayOfWeek === 0 || dayOfWeek === 6) continue; // Haftasonunu geç

                let colIndex = gun + 5; 
                let cell = worksheet.getRow(satirNo).getCell(colIndex);

                // --- YENİ BASİT MANTIK ---
                let tamTarih = `${String(gun).padStart(2, '0')}.${String(ay).padStart(2, '0')}.${yil}`;
                
                // Bu tarihte özel bir kayıt (Yok, Raporlu, İzinli) var mı?
                let oGunkuKayit = oAyinYoklamalari.find(y => y.tcNo === ogr.tcNo && y.tarih === tamTarih);

                if (oGunkuKayit) {
                    // Kayıt varsa ne olduğuna bak
                    if (oGunkuKayit.durum.includes('Devamsız') || oGunkuKayit.durum.includes('Yok')) {
                        cell.value = "D";
                    } else if (oGunkuKayit.durum.includes('İzinli')) {
                        cell.value = "İ"; 
                    } else if (oGunkuKayit.durum.includes('Raporlu')) {
                         cell.value = "R";
                    } else {
                        // "Mevcut" girilmişse +
                        cell.value = "+";
                    }
                } else {
                    // HİÇ KAYIT YOKSA -> VAR KABUL ET (+)
                    cell.value = "+"; 
                }
                
                // --- ORTAK STİL (SİYAH & ORTALI) ---
                cell.alignment = { horizontal: 'center' };
                cell.font = { color: { argb: '00000000' } }; // SİYAH (Red iptal edildi)
            }
            satirNo++;
        });

        // 5. GÖNDER
        const buffer = await workbook.xlsx.writeBuffer();
        const guvenliDosyaAdi = encodeURIComponent(isletmeAdi) + "_Devamsizlik.xlsx";

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${guvenliDosyaAdi}"`);
        res.send(buffer);

    } catch (err) {
        console.error("Excel Hatası:", err);
        res.status(500).send(`<h3>Hata Oluştu</h3><p>${err.message}</p>`);
    }
});










    // ... Eski kodun aynen devam ediyor ...
app.listen(port, () => {
    console.log(`-------------------------------------------`);
    console.log(`🚀 MESEM BULUT SİSTEMİ ÇALIŞIYOR: http://localhost:${port}`);
    console.log(`-------------------------------------------`);
});