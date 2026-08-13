import i18next from 'i18next';

// Initialize i18next with multilingual resources
i18next.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: {
      translation: {
        category: 'Financial Transaction',
        status: 'Processed off main thread',
      },
    },
    es: {
      translation: {
        category: 'Transacción Financiera',
        status: 'Procesado fuera del hilo principal',
      },
    },
    fr: {
      translation: {
        category: 'Transaction Financière',
        status: 'Traité hors du fil principal',
      },
    },
  },
});

export default i18next;
