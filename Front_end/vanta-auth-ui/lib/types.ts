// Successful envelope from the backend
export interface ApiSuccessResponse<T> {
  status: "success";
  message: string;
  data: T;
}

// Failure envelope — `message` is optional because validation errors use `errors`
export interface ApiErrorResponse {
  status: "fail" | "error";
  message?: string;
  errors?: string[];
}

// User returned from signup / signin / /auth/me
export interface User {
  id: string;
  name: string;
  email: string;
  role: "User" | "Admin";
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

// Signin response payload
export interface AuthToken {
  token: string;
  user: User;
}
