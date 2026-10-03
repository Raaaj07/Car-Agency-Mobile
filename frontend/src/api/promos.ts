import { api } from './client';

export interface Promo {
  code: string;
  title: string;
  subtitle: string;
  cta: string;
  discountAmount: number;
  firstRideOnly: boolean;
}

export interface ValidatePromoResult {
  valid: boolean;
  discountAmount: number;
  message: string;
}

export const promosApi = {
  /** GET /promos/active — promos the current rider is eligible for */
  getActive: async (): Promise<Promo[]> => (await api.get<Promo[]>('/promos/active')).data,

  /** POST /promos/validate */
  validate: async (code: string): Promise<ValidatePromoResult> =>
    (await api.post<ValidatePromoResult>('/promos/validate', { code })).data,
};
