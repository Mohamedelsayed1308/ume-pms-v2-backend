import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as XLSX from 'xlsx';
import { MarketRecord } from './market-record.entity';
import { MarketImportLog } from './market-import-log.entity';
import { TRUCK_CATS, computeTripCount, computeTrucksTotal, computeDepartureTrucks, computeArrivalTrucks } from './market.calc';

const NUM_FIELDS = [
  'departure_voyages', 'arrival_voyages',
  ...TRUCK_CATS.map((c) => `dep_${c}`), ...TRUCK_CATS.map((c) => `arr_${c}`),
  'departure_cars', 'arrival_cars', 'departure_passengers', 'arrival_passengers',
];

// خريطة أعمدة Excel → حقول الكيان
const EXCEL_MAP: Record<string, string> = {
  Year: 'year', Month_Number: 'month_number', Month_Name: 'month_name',
  Ship_Key: 'ship_key', Ship_Name_Source: 'ship_name_source', Ship_Name_AR: 'ship_name_ar',
  Agency_Key: 'agency_key', Agency_Name_AR: 'agency_name_ar',
  Departure_Voyages: 'departure_voyages', Arrival_Voyages: 'arrival_voyages', Trip_Count: 'file_trip_count',
  Departure_Trucks_Total: 'file_departure_trucks_total', Arrival_Trucks_Total: 'file_arrival_trucks_total', Trucks_Total: 'file_trucks_total',
  Departure_Cars: 'departure_cars', Arrival_Cars: 'arrival_cars', Cars_Total: 'file_cars_total',
  Departure_Passengers: 'departure_passengers', Arrival_Passengers: 'arrival_passengers', Passengers_Total: 'file_passengers_total',
  Data_Status: 'data_status', Source_Sheet: 'source_sheet',
  // تصنيفات الشاحنات
  Dep_Truck: 'dep_truck', Dep_Dyana: 'dep_dyana', Dep_Lory: 'dep_lory', Dep_Loped: 'dep_loped', Dep_Loader: 'dep_loader', Dep_Equipment: 'dep_equipment', Dep_Head_Track: 'dep_head_track', Dep_Mafi: 'dep_mafi', Dep_Mafi_Empty: 'dep_mafi_empty',
  Arr_Truck: 'arr_truck', Arr_Dyana: 'arr_dyana', Arr_Lory: 'arr_lory', Arr_Loped: 'arr_loped', Arr_Loader: 'arr_loader', Arr_Equipment: 'arr_equipment', Arr_Head_Track: 'arr_head_track', Arr_Mafi: 'arr_mafi', Arr_Mafi_Empty: 'arr_mafi_empty',
};

const num = (v: any) => (v === '' || v == null ? 0 : Number(v));
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();

export interface ImportResult {
  rows_total: number; rows_accepted: number; rows_rejected: number;
  accepted: any[]; rejects: { key: string; row: number; reasons: string[] }[];
  mismatches: { key: string; field: string; file: number; computed: number }[];
}

@Injectable()
export class MarketImportService {
  constructor(
    @InjectRepository(MarketRecord) private recRepo: Repository<MarketRecord>,
    @InjectRepository(MarketImportLog) private logRepo: Repository<MarketImportLog>,
    private ds: DataSource,
  ) {}

  // يحوّل ملف Excel → سجلات مُتحقَّقة + قائمة رفض + اختلافات القيم المحسوبة عن الملف
  parseAndValidate(buffer: Buffer): ImportResult {
    let wb: XLSX.WorkBook;
    try { wb = XLSX.read(buffer, { type: 'buffer', cellDates: true }); } catch { throw new BadRequestException('تعذّر قراءة ملف Excel'); }
    const ws = wb.Sheets['Import_Data'];
    if (!ws) throw new BadRequestException('الملف لا يحتوي شيت Import_Data');
    const raw: any[] = XLSX.utils.sheet_to_json(ws, { defval: null });

    const accepted: any[] = [];
    const rejects: ImportResult['rejects'] = [];
    const mismatches: ImportResult['mismatches'] = [];
    const seen = new Set<string>();

    raw.forEach((row, idx) => {
      const rec: any = {};
      for (const [ex, field] of Object.entries(EXCEL_MAP)) rec[field] = row[ex];
      // أرقام + الفراغ = صفر
      for (const f of NUM_FIELDS) rec[f] = num(rec[f]);
      rec.year = num(rec.year); rec.month_number = num(rec.month_number);
      const key = `${rec.year}-${rec.month_number}-${(rec.ship_key || '').toString().trim().toUpperCase()}`;
      const reasons: string[] = [];

      if (!rec.ship_key) reasons.push('Ship_Key مفقود');
      if (!rec.year || rec.month_number < 1 || rec.month_number > 12) reasons.push('Year/Month غير صالح');
      if (NUM_FIELDS.some((f) => rec[f] < 0)) reasons.push('قيمة سالبة');
      if (seen.has(key)) reasons.push('مكرر داخل الملف (Year+Month+Ship)');

      if (reasons.length) { rejects.push({ key, row: idx + 2, reasons }); return; }
      seen.add(key);

      rec.ship_key = rec.ship_key.toString().trim().toUpperCase();
      // إعادة حساب الحقول المشتقة خادمياً + مقارنتها بقيم الملف
      const trip = computeTripCount(rec);
      const depTr = computeDepartureTrucks(rec), arrTr = computeArrivalTrucks(rec);
      const trucks = computeTrucksTotal(rec);
      const cars = num(rec.departure_cars) + num(rec.arrival_cars);
      const pax = num(rec.departure_passengers) + num(rec.arrival_passengers);
      const cmp = (field: string, computed: number, file: any) => { if (file != null && Number(file) !== computed) mismatches.push({ key, field, file: Number(file), computed }); };
      cmp('trip_count', trip, rec.file_trip_count);
      cmp('trucks_total', trucks, rec.file_trucks_total);
      cmp('departure_trucks_total', depTr, rec.file_departure_trucks_total);
      cmp('arrival_trucks_total', arrTr, rec.file_arrival_trucks_total);
      cmp('cars_total', cars, rec.file_cars_total);
      cmp('passengers_total', pax, rec.file_passengers_total);

      accepted.push({
        year: rec.year, month_number: rec.month_number, month_name: rec.month_name,
        period_start: `${rec.year}-${String(rec.month_number).padStart(2, '0')}-01`,
        period_end: `${rec.year}-${String(rec.month_number).padStart(2, '0')}-${lastDay(rec.year, rec.month_number)}`,
        ship_key: rec.ship_key, ship_name_source: rec.ship_name_source, ship_name_ar: rec.ship_name_ar,
        agency_key: rec.agency_key, agency_name_ar: rec.agency_name_ar,
        departure_voyages: num(rec.departure_voyages), arrival_voyages: num(rec.arrival_voyages), trip_count: trip,
        ...Object.fromEntries(TRUCK_CATS.flatMap((c) => [[`dep_${c}`, num(rec[`dep_${c}`])], [`arr_${c}`, num(rec[`arr_${c}`])]])),
        departure_trucks_total: depTr, arrival_trucks_total: arrTr, trucks_total: trucks,
        departure_cars: num(rec.departure_cars), arrival_cars: num(rec.arrival_cars), cars_total: cars,
        departure_passengers: num(rec.departure_passengers), arrival_passengers: num(rec.arrival_passengers), passengers_total: pax,
        data_status: rec.data_status, source_sheet: rec.source_sheet,
      });
    });

    return { rows_total: raw.length, rows_accepted: accepted.length, rows_rejected: rejects.length, accepted, rejects, mismatches };
  }

  // معاينة فقط (بدون حفظ)
  preview(buffer: Buffer): ImportResult { return this.parseAndValidate(buffer); }

  // حفظ Upsert داخل Transaction واحدة + سجل تدقيق
  async commit(buffer: Buffer, filename: string, user: { id?: string; full_name?: string }): Promise<{ log: MarketImportLog; result: ImportResult }> {
    const result = this.parseAndValidate(buffer);
    if (!result.accepted.length) throw new BadRequestException('لا توجد صفوف صالحة للحفظ');
    const batch = `imp-${Date.now()}`;

    await this.ds.transaction(async (m) => {
      for (const a of result.accepted) {
        const existing = await m.findOne(MarketRecord, { where: { year: a.year, month_number: a.month_number, ship_key: a.ship_key } });
        if (existing) await m.update(MarketRecord, existing.id, { ...a, import_batch: batch });
        else await m.save(MarketRecord, m.create(MarketRecord, { ...a, import_batch: batch }));
      }
    });

    const log = await this.logRepo.save(this.logRepo.create({
      filename, uploaded_by: user.full_name, uploaded_by_id: user.id,
      rows_total: result.rows_total, rows_accepted: result.rows_accepted, rows_rejected: result.rows_rejected,
      rejects: result.rejects, mismatches: result.mismatches, status: 'committed',
    }));
    return { log, result };
  }

  logs() { return this.logRepo.find({ order: { created_at: 'DESC' }, take: 50 }); }
}
