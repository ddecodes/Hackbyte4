export type NodeValidationInfo = {
  status: 'pending' | 'good' | 'warning' | 'error';
  message: string;
};
