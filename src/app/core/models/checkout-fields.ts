// Client details a service can ask for at checkout. Each service marks each
// one required or optional (or doesn't ask for it); checkout asks for what
// the services in the cart ask for. Same list as functions/core/orders.js.

export type FieldRule = 'required' | 'optional';
export type CheckoutFieldKey =
  'phone' | 'address' | 'idNumber' | 'passport' | 'companyName' | 'companyId' | 'registrationId';

export interface CheckoutField {
  key: CheckoutFieldKey;
  label: string;
  hint: string;
  type: 'text' | 'tel';
  autocomplete: string;
  max: number;
}

export const CHECKOUT_FIELDS: CheckoutField[] = [
  { key: 'phone', label: 'Phone', hint: '', type: 'tel', autocomplete: 'tel', max: 30 },
  {
    key: 'address',
    label: 'Address',
    hint: '',
    type: 'text',
    autocomplete: 'street-address',
    max: 300,
  },
  {
    key: 'idNumber',
    label: 'Personal ID number',
    hint: '11 digits',
    type: 'text',
    autocomplete: 'off',
    max: 20,
  },
  {
    key: 'passport',
    label: 'Passport number',
    hint: '',
    type: 'text',
    autocomplete: 'off',
    max: 40,
  },
  {
    key: 'companyName',
    label: 'Company name',
    hint: '',
    type: 'text',
    autocomplete: 'organization',
    max: 200,
  },
  {
    key: 'companyId',
    label: 'Company ID',
    hint: 'identification code',
    type: 'text',
    autocomplete: 'off',
    max: 20,
  },
  {
    key: 'registrationId',
    label: 'Registration ID (rs.ge tax ID)',
    hint: 'the code you use on rs.ge; leave empty if you don’t know it',
    type: 'text',
    autocomplete: 'off',
    max: 20,
  },
];

export type CheckoutRules = Partial<Record<CheckoutFieldKey, FieldRule>>;
