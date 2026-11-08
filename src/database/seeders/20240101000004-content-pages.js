'use strict';

const TERMS_BODY = `<!--TOC-->
<h1>Syarat dan Ketentuan</h1>
<p>Selamat datang di Allergen Detector. Dengan mengakses dan menggunakan layanan ini, Anda menyetujui syarat dan ketentuan yang berlaku. Layanan ini membantu pengguna mengenali potensi alergen pada makanan melalui teknologi deteksi teks dan gambar.</p>
<p>Hasil deteksi bersifat informatif dan bukan pengganti nasihat medis profesional. Pengguna tetap bertanggung jawab memeriksa label kemasan dan berkonsultasi dengan tenaga kesehatan untuk keputusan konsumsi, terutama bagi penderita alergi berat.</p>
<p>Kami dapat memperbarui syarat ini sewaktu-waktu. Penggunaan layanan secara berkelanjutan setelah pembaruan dianggap sebagai persetujuan atas perubahan tersebut. Akun yang menyalahgunakan layanan dapat dibatasi atau dinonaktifkan.</p>`;

const PRIVACY_BODY = `<!--TOC-->
<h1>Kebijakan Privasi</h1>
<p>Kami menghargai privasi Anda. Kebijakan ini menjelaskan data yang kami kumpulkan, seperti informasi akun, riwayat deteksi, dan gambar yang Anda unggah, serta tujuan penggunaannya untuk menyediakan dan meningkatkan layanan deteksi alergen.</p>
<p>Data Anda tidak dibagikan kepada pihak ketiga tanpa persetujuan, kecuali diwajibkan oleh hukum. Gambar dan teks yang diunggah diproses untuk keperluan deteksi dan dapat disimpan sebagai riwayat pribadi yang hanya dapat diakses oleh pemilik akun.</p>
<p>Anda dapat meminta penghapusan data atau akun melalui pengaturan aplikasi atau menghubungi tim kami. Kami menerapkan langkah keamanan yang wajar untuk melindungi data, namun tidak ada sistem yang sepenuhnya kebal terhadap risiko.</p>`;

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('contents', { slug: ['terms', 'privacy'] });
    const now = new Date();
    await queryInterface.bulkInsert('contents', [
      {
        title: 'Syarat dan Ketentuan',
        slug: 'terms',
        body: TERMS_BODY,
        excerpt: 'Syarat dan ketentuan penggunaan layanan Allergen Detector.',
        type: 'page',
        status: 'published',
        published_at: now,
        created_at: now,
        updated_at: now,
      },
      {
        title: 'Kebijakan Privasi',
        slug: 'privacy',
        body: PRIVACY_BODY,
        excerpt: 'Kebijakan privasi dan pengelolaan data pengguna.',
        type: 'page',
        status: 'published',
        published_at: now,
        created_at: now,
        updated_at: now,
      },
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('contents', { slug: ['terms', 'privacy'] });
  },
};
