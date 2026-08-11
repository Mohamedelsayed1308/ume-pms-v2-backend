// ═══════════════════════════════════════════════════════════════════════════
// R3A — LEGACY DATA TAGGING · دفعة LEGACY-2026-08
//
// مولَّد آلياً من  docs/migrations/r3a-legacy-2026-08-manifest.json  — لا يُحرَّر يدوياً.
// العضوية مجمَّدة: المُشغِّل يرفض العمل إن لم تطابق بصمة SHA-256 هذه القائمة القيمةَ المثبَّتة.
//
// المجموعة أُعيد بناؤها (لا استُعيدت) من لقطة الإنتاج، ومُطابَقة تماماً مع بصمة تدقيق R1:
//   paid_without_payments 128 · USD 3,343,933.27 · EUR 190,928.04 · SAR 3,919.89
// لم يُستخدم أي تاريخ أو cutoff أو مورد أو منشئ في تحديد العضوية.
// ═══════════════════════════════════════════════════════════════════════════

export const BATCH_CODE = 'LEGACY-2026-08';

/** بصمة السجلات المعتمدة — تحرس الحقيقة المالية. أي انحراف يوقف الهجرة. */
export const MANIFEST_RECORDS_SHA256 =
  '4c95613ada56bea0c953a15e109c29873c3d23021276771c8933c16ac6cf4901';

export interface LegacyRecord {
  invoice_id: string; invoice_number: string; supplier: string | null;
  currency: string; amount: number; settlement_basis: 'pre_system_settled' | 'credit_note';
}

// [id, رقم الفاتورة, المورد, العملة, المبلغ, مبرّر الإغلاق]
const ROWS: [string, string, string | null, string, number, string][] = [
  ['000e3170-b43d-407e-9e28-0dd840ff5396', "500-105951", "Lloyd's Register Egypt LLC", 'USD', 709, 'pre_system_settled'],
  ['011066e8-2108-4351-86c3-24d9189bb8d1', "LC053420", "Fluid Control Services, Inc.", 'USD', 4037, 'pre_system_settled'],
  ['03ee700f-f0bc-4c81-9f3f-9cd10aaeec0a', "CD5125063480", "El-Mohandes Jotun (S.A.E)", 'USD', 3967.01, 'pre_system_settled'],
  ['03eef1a2-c3a7-42e8-be19-1f0932d052d2', "104338673", "Wärtsilä Polska Sp. z.o.o.", 'EUR', 652.41, 'pre_system_settled'],
  ['05b30180-6a8d-41a8-9458-1862a31832f8', "80330084825", "Soya Group AB", 'USD', 9458, 'pre_system_settled'],
  ['06bc98a0-66f9-4bcd-a97e-0460cb98849e', "INV/3294/1", "Republic of Cyprus - Shipping Deputy Ministry", 'EUR', 4274.18, 'pre_system_settled'],
  ['078530aa-ef09-4d7d-91f0-4251651c17fa', "INVOV1111", "LINEFACE SERVICES FZ-LLC", 'EUR', 27831.5, 'pre_system_settled'],
  ['09358103-9ba7-45ba-8f01-f68143fbd877', "AL/D-26-01-30", "Badawi Shipping Agency", 'USD', 23308.54, 'pre_system_settled'],
  ['0b23e972-2dfb-414b-9382-2743785dddd7', "80330075567", "Soya Group AB", 'USD', 4658, 'pre_system_settled'],
  ['0dc99396-e538-4fcf-8368-9573e0ccc122', "826000815", "Marioff Corporation Oy", 'EUR', 3124, 'pre_system_settled'],
  ['1012e17b-7070-459a-bcf5-286d16a28688', "420260433", "TMS Hamburg Technical Marine Services GmbH", 'EUR', 320, 'pre_system_settled'],
  ['128baf10-fd17-4a00-95e4-19ee64f550e9', "261756", "J. & E. PAPADOPOULOS SA", 'EUR', 726.4, 'pre_system_settled'],
  ['14e93778-eea2-47b8-99cd-a9d3bfc310cd', "80330082837", "Soya Group AB", 'USD', 9458, 'pre_system_settled'],
  ['1590e849-b7f5-4bdd-9b0d-ef8e6a0f69b4', "AL/D-26-02-31", "Badawi Shipping Agency", 'USD', 1151.64, 'pre_system_settled'],
  ['15b60d11-f0b4-492a-974e-a52db58f548d', "AL/D-26-03-33", "Badawi Shipping Agency", 'USD', 1752.65, 'pre_system_settled'],
  ['16f109d0-9fc9-4865-8616-fb0f0254a69a', "228/1", "Chem Service Egypt", 'USD', 15079.87, 'pre_system_settled'],
  ['1789d408-6625-4904-9606-6ed8116d06b2', "CH-26-03-03", "UME Shipping DMCC", 'USD', 15000, 'pre_system_settled'],
  ['1a883660-3897-4ffd-a8d0-544f539f483e', "1026507", "Baluco Ltd", 'USD', 352, 'pre_system_settled'],
  ['201feeb3-fedf-4d55-9f3c-e446a5f701e7', "DT26 100300", "Cathelco Middle East L.L.C- FZ", 'USD', 4989.5, 'pre_system_settled'],
  ['203c9b4c-c05a-4501-8ea0-cb008de2caf1', "242", "Chem Service Egypt", 'EUR', 19325.92, 'pre_system_settled'],
  ['25a2d0cd-9da1-43f8-8c5c-07617685092d', "PF 2026A17/1162", "Ertecna - Empresa de Revestimentos Técnicos, Lda", 'EUR', 3648.86, 'pre_system_settled'],
  ['268570eb-161d-4a7f-bc30-4756e27b5657', "AL/D-26-01-29", "Badawi Shipping Agency", 'USD', 11640.78, 'pre_system_settled'],
  ['27eceae2-d7e2-4b9e-8627-055df6f8542b', "500-105993", "Lloyd's Register Egypt LLC", 'USD', 2720, 'pre_system_settled'],
  ['29ea9847-0719-485d-93ea-b106282693e3', "2025-58271", "Hanseaticsoft GmbH", 'EUR', 1944.54, 'pre_system_settled'],
  ['2b0fe03d-cfca-4a7f-b92c-10d32cdc9ef2', "B-26042", "GULF AGENCY CO. (EGYPT) LTD.", 'USD', 13743.04, 'pre_system_settled'],
  ['302f76c5-3398-4ff2-aa16-928f591032b1', "215/1", "Chem Service Egypt", 'USD', 1068.26, 'pre_system_settled'],
  ['311000a8-f40c-46f7-a7d1-e33d95c63823', "10567-1-2026", "Fairwater Energy AB", 'USD', 120110, 'pre_system_settled'],
  ['34bdb70e-869a-4762-a875-11ed1d63f1e7', "2024221", "UME Shipping AB", 'USD', 31350, 'pre_system_settled'],
  ['3665237e-b432-4caf-9af1-721fdf167f6a', "INVOV956", "LINEFACE SERVICES FZ-LLC", 'EUR', 2732.2, 'pre_system_settled'],
  ['372a9f0b-1a28-46dc-b3a8-056c9c5c8058', "CN-26-04-01", "HansaScan Trading DMCC", 'USD', -31131.75, 'credit_note'],
  ['38bcecb0-a807-4b47-86af-f520d8fe7e04', "205/1", "Chem Service Egypt", 'USD', 1480, 'pre_system_settled'],
  ['399cd449-4da6-4780-a653-254ed9d804b9', "104338282", "Wärtsilä Polska Sp. z.o.o.", 'EUR', 7219.52, 'pre_system_settled'],
  ['39cc8cd5-c7b3-48e9-8c3c-bf56b75defd8', "10504-1-2026", "Fairwater Energy AB", 'EUR', 32860, 'pre_system_settled'],
  ['3a60cdf7-780f-402c-9e61-494c531e7f97', "105302046", "Wärtsilä Ships Repairing & Maintenance LLC", 'USD', 1441.5, 'pre_system_settled'],
  ['3d01b4ee-ad04-48f2-9899-3969708abcbd', "B-26068", "GULF AGENCY CO. (EGYPT) LTD.", 'USD', 48700.07, 'pre_system_settled'],
  ['3d34d507-8fda-41da-9966-9260f56597f6', "0000012659", "CHRYSSES DEMETRIADES & CO. LLC", 'EUR', 150, 'pre_system_settled'],
  ['3ec60461-fc7c-4cd2-a5b9-eba04e3a18fa', "SMINV-250560-PI", "Sphinx Marine", 'USD', 3000, 'pre_system_settled'],
  ['4142d356-650d-4631-adb8-92399dcd4c08', "325115", "Sperre Air Power AS", 'EUR', 4606.22, 'pre_system_settled'],
  ['4149cb26-9bbc-454b-bbf1-5b5ee0abef0b', "105302049", "Wärtsilä Ships Repairing & Maintenance LLC", 'USD', 16102.02, 'pre_system_settled'],
  ['42fe7561-bb1a-4fdf-9b40-ef2829684009', "204/1", "Chem Service Egypt", 'USD', 2065, 'pre_system_settled'],
  ['4476465a-304a-4bcf-bbb7-c426272fa75e', "AL/D-26-01-36", "Badawi Shipping Agency", 'USD', 1565.68, 'pre_system_settled'],
  ['4c3e988c-d299-4191-adf5-aab1d27314fc', "104338481", "Wärtsilä Polska Sp. z.o.o.", 'EUR', 527.25, 'pre_system_settled'],
  ['4ee2ea86-dedb-4297-820b-c51e716a7cd9', "500C100471", "Lloyd's Register Egypt LLC", 'USD', -583, 'credit_note'],
  ['4ff21793-5d33-4c47-bfc6-bf45837113f5', "105301938", "Wärtsilä Ships Repairing & Maintenance LLC", 'USD', 21858.41, 'pre_system_settled'],
  ['52f4e645-f3cc-4496-8a54-e5fe8d2090d0', "AL/D-26-05-27", "Badawi Shipping Agency", 'USD', 46908.52, 'pre_system_settled'],
  ['5530ccba-483f-4462-8d30-22d12ae80227', "CH-26-06-03", "UME Shipping DMCC", 'USD', 15000, 'pre_system_settled'],
  ['568d75be-0e11-4e6a-bd7d-67d18b2a78a3', "90134052", "Turbo Systems Egypt for Turbocharging LLC", 'USD', 4420.8, 'pre_system_settled'],
  ['5837dff2-de56-4c23-be04-e32a8d1b6c15', "AL/D-26-05-23", "Badawi Shipping Agency", 'USD', 15547.72, 'pre_system_settled'],
  ['58c15547-381c-4f74-adc0-98621d1fbb0b', "CD5126026951", "El-Mohandes Jotun (S.A.E)", 'USD', 24450.29, 'pre_system_settled'],
  ['5f0feacf-b028-4639-b14b-5e0296193617', "FZ-SVE-CN-00000157", "ELCOME MARINE EGYPT - FREE ZONE", 'USD', -70, 'credit_note'],
  ['5fffbd94-29ed-426c-80ed-3eb1e4e4ccda', "B-26032", "GULF AGENCY CO. (EGYPT) LTD.", 'USD', 163514.12, 'pre_system_settled'],
  ['6229ce07-333d-4e8d-80e8-b476f7983a86', "104338397", "Wärtsilä Polska Sp. z.o.o.", 'EUR', 1831.27, 'pre_system_settled'],
  ['66726726-2d7d-4bb4-9e05-77662c1b2009', "2026-60331", "Hanseaticsoft GmbH", 'EUR', 1944.54, 'pre_system_settled'],
  ['68cbb0b7-778e-4573-bad1-3abf2f68d243', "IWMSEG04CD970010955", "Wilhelmsen Ships Service LLC - Free Zone", 'USD', 18817.61, 'pre_system_settled'],
  ['6957dd7f-c850-441f-836d-d99fdeaeee35', "AL/D-26-01-33", "Badawi Shipping Agency", 'USD', 90678.3, 'pre_system_settled'],
  ['6958f20a-8278-4727-ad12-75ed674f26f0', "80330081128", "Soya Group AB", 'USD', 9458, 'pre_system_settled'],
  ['702b701d-8b9b-4ed4-af08-8115ca95b032', "2026-10011", "BGM Trading GmbH", 'EUR', 862.6, 'pre_system_settled'],
  ['723e18c1-dba7-4a92-9fab-667e774694fa', "SMINV-260131-PI", "Sphinx Marine", 'USD', 3500, 'pre_system_settled'],
  ['7517f1bb-69f0-4946-8f6d-298f6da339bc', "904116314", "Weilbach Egypt Ltd.", 'USD', 1105, 'pre_system_settled'],
  ['757dfb08-d706-40ae-acbf-39266d6e92b7', "AL/D-26-03-27", "Badawi Shipping Agency", 'USD', 17368.64, 'pre_system_settled'],
  ['75a20f4b-48a0-4db0-b047-58c50a42074e', "WS/1768/26", "Western Fuel Supply for Petroleum Products Company Limited - Jeddah", 'USD', 501376, 'pre_system_settled'],
  ['762e528c-53e5-43de-96d8-cd127d49b216', "10144-1-2025", "Fairwater Energy AB", 'EUR', 16000, 'pre_system_settled'],
  ['7c48f232-0340-4950-84ff-569dfe271e4a', "113/1", "Chem Service Egypt", 'USD', 1265, 'pre_system_settled'],
  ['82836c56-f746-44da-8964-1e6bf4ba8425', "AL/D-26-03-31", "Badawi Shipping Agency", 'USD', 104469.93, 'pre_system_settled'],
  ['83bb51a7-1f44-40d2-a08b-a1cc2527f414', "CH-26-07-03", "UME Shipping DMCC", 'USD', 15000, 'pre_system_settled'],
  ['85fd2094-5eab-455d-a15e-65bfb987cf90', "AL/D-26-04-23", "Badawi Shipping Agency", 'USD', 54206.48, 'pre_system_settled'],
  ['8a672bac-c1f8-4d42-b696-3ee25a0e1b21', "401", "Smart Fleet Marine", 'SAR', 3919.89, 'pre_system_settled'],
  ['8eb60598-b090-4b8f-8d46-6596ab41a8c1', "1025663", "Baluco Ltd", 'USD', 544, 'pre_system_settled'],
  ['91da7302-de72-4ee9-a7ce-bec16e640999', "2024307", "UME Shipping AB", 'EUR', -1775, 'credit_note'],
  ['9257388f-4ec8-4442-965a-800bbde027a5', "80330072515", "Soya Group AB", 'USD', 27346, 'pre_system_settled'],
  ['953d4235-9a7d-4470-a2f3-68d26ea91de3', "AL/D-26-02-25", "Badawi Shipping Agency", 'USD', 15716.86, 'pre_system_settled'],
  ['97de92e8-a3d5-4ba7-8c53-8f7dc7b34965', "26-06-03-", "UME Shipping DMCC", 'USD', 2300, 'pre_system_settled'],
  ['9a166b90-1f6d-4349-8fed-efc152099c2d', "B – 32", "C.T.E. PERDIKARIS ENGINEERING, ARCHITECTURAL & TECHNICAL SERVICES PRIVATE COMPANY", 'EUR', 7100, 'pre_system_settled'],
  ['9bec7763-3294-4cee-9fa9-92a16cff57c6', "T202682370", "GW SPRINKLER A/S", 'EUR', 4506.48, 'pre_system_settled'],
  ['9dc81750-8fcc-4a3d-8024-fa9ac05ac28a', "AL/D-26-05-24", "Badawi Shipping Agency", 'USD', 17714.99, 'pre_system_settled'],
  ['9e2292f6-a7cf-42a6-94b2-c16c795475fc', "26-04-11", "HansaScan Trading DMCC", 'USD', 619521.83, 'pre_system_settled'],
  ['9ee305ac-77ea-426c-bd65-df39dcb2801e', "SMINV-260132-PI", "Sphinx Marine", 'USD', 4450, 'pre_system_settled'],
  ['a0617181-5f15-4088-a675-9e4400c47ea2', "104338488", "Wärtsilä Polska Sp. z.o.o.", 'EUR', 94.14, 'pre_system_settled'],
  ['a3fbb1c1-121d-4911-9e4d-116a57375f71', "SMINV-250528-PI", "Sphinx Marine", 'USD', 720, 'pre_system_settled'],
  ['a5154990-9b4a-49e6-ace6-76b1d6abe579', "B-26007", "GULF AGENCY CO. (EGYPT) LTD.", 'USD', 40381.7, 'pre_system_settled'],
  ['a6f06e37-968a-4b50-a3db-a2c3dd81769d', "01909/02200/06390/2025/MW", "BALTIC SPARES SERVICE SPÓŁKA Z O. O.", 'EUR', 5142, 'pre_system_settled'],
  ['a79164d2-4714-468f-8ee4-bddfddd42d26', "CH-26-05-03", "UME Shipping DMCC", 'USD', 15000, 'pre_system_settled'],
  ['a9d5646e-7278-41d7-9568-f3c6d5a84786', "FZ-SVE-IN-00000468", "ELCOME MARINE EGYPT - FREE ZONE", 'USD', 2550, 'pre_system_settled'],
  ['aa0aac6e-f91b-4aa1-bfb9-a09fe0808653', "500-105877", "Lloyd's Register Egypt LLC", 'USD', 2329, 'pre_system_settled'],
  ['aa16b3ba-132f-42da-a9c9-70e4c13ad360', "AL/D-26-04-25", "Badawi Shipping Agency", 'USD', 1518.62, 'pre_system_settled'],
  ['aa887f2f-ccbf-47a8-9197-39210fd42159', "10369-1-2026", "Fairwater Energy AB", 'USD', 185000, 'pre_system_settled'],
  ['ab1e8465-7191-4189-9d41-1d51f2deb334', "B-26034", "GULF AGENCY CO. (EGYPT) LTD.", 'USD', 82253.85, 'pre_system_settled'],
  ['ac6fd659-82f7-4705-b283-88f532856d5d', "9101130844", "Elektror airsystems GmbH", 'EUR', 50, 'pre_system_settled'],
  ['ae29f795-0944-4fd0-a440-2f46cda09be0', "80330071137", "Soya Group AB", 'USD', 4658, 'pre_system_settled'],
  ['b1083045-0ec4-4fbc-8fd3-b2524013b3e6', "80330077274", "Soya Group AB", 'USD', 9458, 'pre_system_settled'],
  ['b13292cf-df17-4fcf-bedf-e53701806803', "CH-26-02-03", "UME Shipping DMCC", 'USD', 15000, 'pre_system_settled'],
  ['b13d0228-ae75-4859-a74b-37ab28217384', "INVOV1378", "LINEFACE SERVICES FZ-LLC", 'USD', 2140.12, 'pre_system_settled'],
  ['b17bd91a-e96b-4353-baaf-9901952c11c1', "500-106203", "Lloyd's Register Egypt LLC", 'USD', 1330, 'pre_system_settled'],
  ['b3dde820-de73-407a-b302-7cb6ecd80f99', "B-26040", "GULF AGENCY CO. (EGYPT) LTD.", 'USD', 41647.8, 'pre_system_settled'],
  ['b874937b-b4c2-4e4d-ad6f-9835f4de1f54', "500-106109", "Lloyd's Register Egypt LLC", 'USD', 840, 'pre_system_settled'],
  ['bd4863e1-b51f-49e7-88b9-ae6d058f74e4', "CH-26-04-03", "UME Shipping DMCC", 'USD', 15000, 'pre_system_settled'],
  ['bf8847e6-fd0e-4ad8-970a-15b764639db4', "80330079155", "Soya Group AB", 'USD', 9458, 'pre_system_settled'],
  ['c0c0ef0b-e962-4ffd-b10a-118e07030050', "AL/D-26-04-19", "Badawi Shipping Agency", 'USD', 12496.56, 'pre_system_settled'],
  ['c1963d33-f45f-48e9-b2da-8f7ad17d015a', "2024220", "UME Shipping AB", 'USD', 31350, 'pre_system_settled'],
  ['c47391ac-78a7-4acd-b117-41485f3add88', "114", "Chem Service Egypt", 'USD', 5087.44, 'pre_system_settled'],
  ['c5bd9d38-c61b-46b5-b016-ae36789d8c91', "10506-1-2026", "Fairwater Energy AB", 'EUR', 6616, 'pre_system_settled'],
  ['c9163b5a-e3de-4f9c-9a26-6b024ee672ec', "AL/D-26-02-28", "Badawi Shipping Agency", 'USD', 37620.84, 'pre_system_settled'],
  ['cd85bf23-a4cb-4973-8ceb-628d64216e53', "AL/D-26-02-24", "Badawi Shipping Agency", 'USD', 20019.79, 'pre_system_settled'],
  ['cf926845-412c-4939-b1cf-ec36834a6029', "M43/70106327", "Neuver Maritime AS", 'EUR', 19239.68, 'pre_system_settled'],
  ['d25da52b-06ce-4724-9415-aa447a88dc7f', "AL/D-26-02-30", "Badawi Shipping Agency", 'USD', 1876.99, 'pre_system_settled'],
  ['d4291be2-32dd-4cd2-969b-82730c39ecea', "AL/D-26-06-21", "Badawi Shipping Agency", 'USD', 16367.74, 'pre_system_settled'],
  ['d44b4892-be04-4308-abda-f48e01d400c8', "80330073125", "Soya Group AB", 'USD', 4658, 'pre_system_settled'],
  ['d6b28c48-0bc6-4ab6-afda-1b127c1d3738', "F-26006", "GULF AGENCY CO. (EGYPT) LTD.", 'USD', 363277.68, 'pre_system_settled'],
  ['d81c5c8d-d819-4674-87a6-e7bab72ed45f', "104338281", "Wärtsilä Polska Sp. z.o.o.", 'EUR', 4363.36, 'pre_system_settled'],
  ['d850a127-b6eb-4aa9-b520-1d1740b47980', "CH-26-01-03", "UME Shipping DMCC", 'USD', 15000, 'pre_system_settled'],
  ['dd28acba-0599-4fd2-91f3-2b251b3f3430', "AL/D-26-06-22", "Badawi Shipping Agency", 'USD', 16126.53, 'pre_system_settled'],
  ['deb2651d-741b-4755-b077-cf17f0ad4b89', "139666", "Dr. E. Horn GmbH & Co. KG", 'EUR', 2662, 'pre_system_settled'],
  ['df0d12a6-4252-4854-8ce1-cbe306d69cbd', "AL/D-26-04-20", "Badawi Shipping Agency", 'USD', 12989.72, 'pre_system_settled'],
  ['dfb49347-4ab4-4cbe-a28c-c94a2b48f1b6', "AL/D-26-03-28", "Badawi Shipping Agency", 'USD', 16548.28, 'pre_system_settled'],
  ['e1230d92-b48b-4cd3-823f-b7f2c310a02a', "262035", "EMPSE GROUP SL", 'EUR', 3202.6, 'pre_system_settled'],
  ['e3c127e1-0c51-4f7e-9ad7-a745f43adc69', "INV-2026-63540", "Hanseaticsoft GmbH", 'EUR', 1944.54, 'pre_system_settled'],
  ['e677e168-1a79-432b-b366-5e634d025d98', "S2014765", "INSATECH A/S", 'EUR', 1546.78, 'pre_system_settled'],
  ['e807c348-be8c-4673-a876-3a22dbae7446', "2024222", "UME Shipping AB", 'USD', 31350, 'pre_system_settled'],
  ['edfb6119-1a48-4012-a6fb-ac627945a5c7', "105302048", "Wärtsilä Ships Repairing & Maintenance LLC", 'USD', 7824.07, 'pre_system_settled'],
  ['f20b0747-96a9-4128-a3c1-4decadda6b05', "AL/D-26-01-35", "Badawi Shipping Agency", 'USD', 1326.27, 'pre_system_settled'],
  ['f21aa4d7-1905-4361-8bd2-5ca5a8ec82b6', "2024314", "UME Shipping AB", 'EUR', -1775, 'credit_note'],
  ['f21b262e-c662-4bf1-969b-3bb035422664', "104339005", "Wärtsilä Polska Sp. z.o.o.", 'EUR', 279.05, 'pre_system_settled'],
  ['f22c2302-4554-41bf-9ea7-efdc05187a67', "824179", "International Marine Purchasing Association Ltd", 'EUR', 50, 'pre_system_settled'],
  ['f430f929-0607-4114-a287-912b35bd338f', "IWMSEG04CD970010811", "Wilhelmsen Ships Service LLC - Free Zone", 'USD', 5749.85, 'pre_system_settled'],
  ['f66ecbdd-b4c8-4ae6-a6cc-effac6c38c95', "B-26036", "GULF AGENCY CO. (EGYPT) LTD.", 'USD', 82394.9, 'pre_system_settled'],
  ['f8a2c2f6-f123-429c-b2e0-973747b788f4', "90131747", "Turbo Systems Egypt for Turbocharging LLC", 'USD', 4637.52, 'pre_system_settled'],
  ['fe91df05-6578-4068-bf75-eeeb499c8f58', "AL/D-26-03-34", "Badawi Shipping Agency", 'USD', 1319.54, 'pre_system_settled'],
  ['ff2e942b-6033-4fcc-bfdd-c604c7c1c2ac', "AL/D-26-06-25", "Badawi Shipping Agency", 'USD', 49395.65, 'pre_system_settled'],
];

export const LEGACY_RECORDS: LegacyRecord[] = ROWS.map(
  ([invoice_id, invoice_number, supplier, currency, amount, settlement_basis]) =>
    ({ invoice_id, invoice_number, supplier, currency, amount, settlement_basis } as LegacyRecord),
);

export const EXPECTED_COUNT = 128;
export const EXPECTED_PRE_SYSTEM_SETTLED = 123;
export const EXPECTED_CREDIT_NOTE = 5;

/** بصمة R1 المالية — المجموع المطلق للمسدَّد لكل عملة، كما تحسبه قاعدة التدقيق. */
export const R1_SIGNATURE: Record<string, number> = {"USD":3343933.27,"EUR":190928.04,"SAR":3919.89};

// ── أسماء كائنات المخطط ──────────────────────────────────────────────────────
// تُطابِق حرفياً ما يعلنه Invoice entity. TypeORM يوفّق القيود بالاسم فقط،
// وأي قيد لا يعرفه على جدول متزامَن يُسقِطه عند الإقلاع — فالتطابق شرط بقاء.
export const FK_IMPORT_BATCH = 'fk_invoices_import_batch';
export const CHK_DATA_ORIGIN = 'chk_inv_data_origin';
export const CHK_SETTLEMENT_BASIS = 'chk_inv_settlement_basis';
export const CHK_PRESYSTEM_REQUIRES_BATCH = 'chk_inv_presystem_requires_batch';

export const CHK_DATA_ORIGIN_EXPR = "data_origin IN ('operational','migrated')";
export const CHK_SETTLEMENT_BASIS_EXPR =
  "settlement_basis IN ('payment_record','pre_system_settled','credit_note','none')";
export const CHK_PRESYSTEM_REQUIRES_BATCH_EXPR =
  "settlement_basis <> 'pre_system_settled' OR (data_origin = 'migrated' AND import_batch_id IS NOT NULL)";

// ── STEP A · المخطط ─────────────────────────────────────────────────────────
// كله متكرّر الأمان. Postgres يدعم DDL معامَلاتياً ⇒ المُشغِّل يلفّه في معاملة واحدة.
export const SCHEMA_UP: string[] = [
  `CREATE TABLE IF NOT EXISTS import_batches (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     batch_code VARCHAR(50) NOT NULL UNIQUE,
     description VARCHAR(500) NOT NULL,
     classification_reason TEXT NOT NULL,
     source VARCHAR(200),
     approved_by_name VARCHAR(150),
     approval_reference VARCHAR(200),
     approved_at DATE,
     notes TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `ALTER TABLE invoices
     ADD COLUMN IF NOT EXISTS data_origin      VARCHAR(20) NOT NULL DEFAULT 'operational',
     ADD COLUMN IF NOT EXISTS settlement_basis VARCHAR(30) NOT NULL DEFAULT 'none',
     ADD COLUMN IF NOT EXISTS import_batch_id  UUID`,

  `COMMENT ON COLUMN invoices.settlement_basis IS
     'none = غير مصنَّفة صراحةً؛ اشتقّ الحقيقة من سجلات السداد. ليست نفياً للتسوية.'`,

  `COMMENT ON COLUMN invoices.data_origin IS
     'operational = نشأت داخل PMS · migrated = أُدخلت لاحقاً لأغراض الأرشفة'`,

  `DO $$ BEGIN
     ALTER TABLE invoices ADD CONSTRAINT ${FK_IMPORT_BATCH}
       FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE RESTRICT;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
     ALTER TABLE invoices ADD CONSTRAINT ${CHK_DATA_ORIGIN} CHECK (${CHK_DATA_ORIGIN_EXPR});
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
     ALTER TABLE invoices ADD CONSTRAINT ${CHK_SETTLEMENT_BASIS} CHECK (${CHK_SETTLEMENT_BASIS_EXPR});
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
     ALTER TABLE invoices ADD CONSTRAINT ${CHK_PRESYSTEM_REQUIRES_BATCH}
       CHECK (${CHK_PRESYSTEM_REQUIRES_BATCH_EXPR});
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
];

// ── STEP B · إنشاء الدفعة ────────────────────────────────────────────────────
// حقول الاعتماد الأربعة تبقى NULL — لا سند إداري حقيقي، ولا اختلاق.
export const BATCH_INSERT = `
INSERT INTO import_batches (batch_code, description, classification_reason, notes)
VALUES ($1, $2, $3, $4)
ON CONFLICT (batch_code) DO NOTHING`;

export const BATCH_DESCRIPTION =
  'استيراد تاريخي — فواتير مسددة قبل تشغيل UME PMS، أُدخلت للأرشفة';

export const BATCH_CLASSIFICATION_REASON =
  'تأكيد الإدارة: هذه السجلات سُدِّدت فعلياً قبل إنشاء/استخدام PMS. سجلات السداد الأصلية ' +
  'خارج النظام، وعدم وجودها داخله لا يعني عدم السداد. التعرُّض المالي لهذه المجموعة = صفر. ' +
  'لم يُنشأ أي سجل دفع ولم يُختلق تاريخ ولا مرجع بنكي. ' +
  'الإشعارات الدائنة داخل الدفعة مبرَّرها credit_note لا pre_system_settled: ' +
  'الإشعار الدائن يخفّض التزاماً ولا يمثّل سداداً.';

export const BATCH_NOTES =
  'العضوية مجمَّدة في docs/migrations/r3a-legacy-2026-08-manifest.json — ' +
  'بصمة السجلات sha256:' + MANIFEST_RECORDS_SHA256 + '. ' +
  'المجموعة أُعيد بناؤها ومُطابَقت تماماً مع بصمة تدقيق R1 المالية. لم يُستخدم أي heuristic.';

// ── STEP C · التوسيم ─────────────────────────────────────────────────────────
// العضوية من جدول staging المشتق حرفياً من البيان — لا شرط ديناميكي إطلاقاً.
export const STAGING_CREATE = `
CREATE TEMP TABLE r3a_staging (
  invoice_id UUID PRIMARY KEY,
  invoice_number VARCHAR(100) NOT NULL,
  currency VARCHAR(10) NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  settlement_basis VARCHAR(30) NOT NULL
) ON COMMIT DROP`;

/** لا يمسّ status ولا approval_status ولا paid_amount ولا أي حقل مالي. */
export const TAG_UPDATE = `
UPDATE invoices i
   SET data_origin = 'migrated',
       settlement_basis = s.settlement_basis,
       import_batch_id = $1
  FROM r3a_staging s
 WHERE i.id = s.invoice_id
   AND i.data_origin = 'operational'
RETURNING i.id`;
