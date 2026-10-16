export const doctor = {
  name: "Ana Karina de Sousa Fernandes",
  professionalName: "Dra. Ana Karina Fernandes",
  shortName: "Dra. Ana Karina",
  title: "Pediatra e Pneumologista Pediátrica",
  specialtyLine: "Pneumologia pediátrica",
  roles: "Pediatra, pneumopediatra e intensivista pediátrica",
  crm: "CRM-RN 5751",
  rqePediatria: "RQE Pediatria 1557",
  rqePneumologia: "RQE Pneumologia Pediátrica 6271",
  yearsOfExperience: "13 anos",
  medicalSchool: "Universidade Federal de Campina Grande",
  pediatricsResidency: "Hospital Infantil Albert Sabin - Fortaleza/CE",
  pulmonologyResidency: "Hospital Infantil Albert Sabin - Fortaleza/CE",
  shortBio:
    "Pediatra, pneumopediatra e intensivista pediátrica, com trajetória consolidada pela sólida formação técnica em instituições de referência e pela dedicação ao ensino médico. Sua atuação é pautada pelo rigor científico, atualização constante, escuta ativa e cuidado humanizado à saúde infantil.",
  targetAudience: "Recém-nascidos, bebês, crianças e adolescentes",
  city: "Mossoró",
  state: "RN",
  /** Único local exibido no site (sem nome da clínica, endereço ou dia de atendimento). */
  location: "Mossoró - RN",
  homeVisits: "Consultas domiciliares conforme demanda",
  paymentModel: "Atendimento particular",
  phone: "5584981880777",
  displayPhone: "(84) 98188-0777",
  email: "anakarinapneumo@gmail.com",
  instagram: "dra.anakarina.pneumo",
  whatsappMessage:
    "Olá, gostaria de agendar uma consulta com a Dra. Ana Karina Fernandes. Encontrei o contato pelo site.",
  hasProfessionalPhoto: true,
  hasVisualIdentity: true,
  hasClinicPhotos: false,
};

export const whatsappHref = `https://wa.me/${doctor.phone}?text=${encodeURIComponent(
  doctor.whatsappMessage,
)}`;

export const instagramHref = `https://instagram.com/${doctor.instagram}`;

/** Formação, na ordem em que aparece na linha do tempo (mais recente primeiro). */
export const education = [
  {
    title: "Residência em Pneumologia Pediátrica",
    place: doctor.pulmonologyResidency,
  },
  {
    title: "Residência em Pediatria",
    place: doctor.pediatricsResidency,
  },
  {
    title: "Graduação em Medicina",
    place: doctor.medicalSchool,
  },
  {
    title: "Intensivismo pediátrico e ensino médico",
    place: `${doctor.crm} · ${doctor.rqePediatria} · ${doctor.rqePneumologia}`,
  },
];

/** Três compromissos do atendimento (fonte única para a home e a página Sobre). */
export const commitments = [
  "Consulta minuciosa e detalhada",
  "Escuta ativa e humanizada",
  "Foco na prevenção",
];

/** Faixa de credenciais da primeira dobra. */
export const credentials = [
  { value: doctor.yearsOfExperience, label: "de atuação em pediatria" },
  { value: "Albert Sabin", label: "residências em Pediatria e Pneumologia" },
  { value: "RQE 6271", label: "Pneumologia Pediátrica" },
];
