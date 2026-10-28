import { API_BASE_URL } from '../config';

export interface RegisterUserRequest {
  username: string;
  phoneNumber?: string;
  email?: string;
  password: string;
  confirmPassword: string;
}

export interface LoginUserRequest {
  usernameOrPhoneOrEmail: string;
  password: string;
}

export interface Account {
  entityKey: string;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  courses: unknown[];
}

export interface Course {
  entityKey: string;
  name: string | null;
  isActive?: boolean;
  prescriptionSchedules?: PrescriptionSchedule[];
}

export interface Dose {
  entityKey: string;
  isActive: boolean;
  time: string;
  isTaken: boolean;
}

export interface Medicine {
  entityKey: string;
  isActive: boolean;
  name: string | null;
}

export interface PrescriptionSchedule {
  entityKey: string;
  isActive: boolean;
  medicine: {
    entityKey: string;
    isActive: boolean;
    name: string | null;
  };
  doses: Dose[];
}

export interface CreatePrescriptionScheduleRequest {
  courseKey: string;
  medicineName: string;
  medicineKey: string | null;
  durationInDays: number;
  startDate: string;
  dailyDoseTimes: string[];
}

export interface TakeDoseRequest {
  doseKey: string;
  takeUntake: boolean;
}

export interface CreateAccountRequest {
  firstName: string | null;
  lastName: string | null;
}

export interface CreateCourseRequest {
  accountKey: string;
  name: string;
}

export interface LoginResponse {
  token: string;
  defaultAccount?: Account | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsePrescriptionSchedule(
  value: unknown,
  label: string,
): PrescriptionSchedule {
  if (
    !isRecord(value) ||
    typeof value.entityKey !== 'string' ||
    typeof value.isActive !== 'boolean' ||
    !isRecord(value.medicine) ||
    typeof value.medicine.entityKey !== 'string' ||
    typeof value.medicine.isActive !== 'boolean' ||
    (value.medicine.name !== null &&
      typeof value.medicine.name !== 'string') ||
    (value.doses !== null && !Array.isArray(value.doses))
  ) {
    throw new Error(`${label} has an invalid response shape.`);
  }

  const doses = (value.doses ?? []).map((dose, index): Dose => {
    if (
      !isRecord(dose) ||
      typeof dose.entityKey !== 'string' ||
      typeof dose.isActive !== 'boolean' ||
      typeof dose.time !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T/.test(dose.time) ||
      !Number.isFinite(Date.parse(dose.time)) ||
      typeof dose.isTaken !== 'boolean'
    ) {
      throw new Error(
        `${label} dose ${index + 1} has an invalid response shape.`,
      );
    }

    return {
      entityKey: dose.entityKey,
      isActive: dose.isActive,
      time: dose.time,
      isTaken: dose.isTaken,
    };
  });

  return {
    entityKey: value.entityKey,
    isActive: value.isActive,
    medicine: {
      entityKey: value.medicine.entityKey,
      isActive: value.medicine.isActive,
      name: value.medicine.name,
    },
    doses,
  };
}

function parseCourse(value: unknown, label: string): Course {
  if (!isRecord(value) || typeof value.entityKey !== 'string') {
    throw new Error(`${label} has an invalid response shape.`);
  }

  const name = value.name ?? null;
  const isActive = value.isActive;
  const prescriptionSchedules = value.prescriptionSchedules;
  if (
    (name !== null && typeof name !== 'string') ||
    (isActive !== undefined && typeof isActive !== 'boolean') ||
    (prescriptionSchedules !== undefined &&
      !Array.isArray(prescriptionSchedules))
  ) {
    throw new Error(`${label} has an invalid response shape.`);
  }

  const parsedSchedules = prescriptionSchedules?.map((schedule, index) =>
    parsePrescriptionSchedule(schedule, `${label} schedule ${index + 1}`),
  );

  return {
    entityKey: value.entityKey,
    name,
    ...(typeof isActive === 'boolean' ? { isActive } : {}),
    ...(parsedSchedules ? { prescriptionSchedules: parsedSchedules } : {}),
  };
}

async function getErrorMessage(response: Response): Promise<string> {
  const body = await response.text();
  if (!body) {
    return `Request failed (${response.status} ${response.statusText}).`;
  }

  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'string') {
      return parsed;
    }

    if (isRecord(parsed)) {
      const problem = parsed;
      for (const key of ['detail', 'title', 'message', 'error']) {
        if (typeof problem[key] === 'string') {
          return problem[key];
        }
      }

      const errors = problem.errors;
      if (errors && typeof errors === 'object') {
        const messages = Object.values(errors)
          .flatMap((value) => (Array.isArray(value) ? value : [value]))
          .filter((value): value is string => typeof value === 'string');
        if (messages.length > 0) {
          return messages.join('\n');
        }
      }
    }
  } catch {
    return body;
  }

  return body;
}

async function postJson(path: string, payload: object): Promise<Response> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return response;
}

async function authorizedRequest(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return response;
}

export async function registerUser(
  request: RegisterUserRequest,
): Promise<void> {
  await postJson('/Users/Register', request);
}

export async function loginUser(
  request: LoginUserRequest,
): Promise<LoginResponse> {
  const response = await postJson('/Users/Login', request);
  const result: unknown = await response.json();

  if (
    !result ||
    typeof result !== 'object' ||
    !('token' in result) ||
    typeof result.token !== 'string' ||
    result.token.length === 0
  ) {
    throw new Error('The API login response did not contain a token.');
  }

  return result as LoginResponse;
}

export async function createAccount(
  token: string,
  request: CreateAccountRequest,
): Promise<void> {
  await authorizedRequest('/Accounts', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
}

export async function deleteAccount(
  token: string,
  accountKey: string,
): Promise<void> {
  await authorizedRequest(
    `/Accounts/${encodeURIComponent(accountKey)}`,
    token,
    { method: 'DELETE' },
  );
}

export async function getAccounts(token: string): Promise<Account[]> {
  const response = await authorizedRequest('/Accounts', token);
  const result: unknown = await response.json();
  if (!Array.isArray(result)) {
    throw new Error('The accounts API response was not a list.');
  }

  return result.map((account, index) => {
    if (!isRecord(account) || typeof account.entityKey !== 'string') {
      throw new Error(`Account ${index + 1} has an invalid response shape.`);
    }

    const firstName = account.firstName ?? null;
    const lastName = account.lastName ?? null;
    const isActive = account.isActive;
    const courses = account.courses;

    if (
      (firstName !== null && typeof firstName !== 'string') ||
      (lastName !== null && typeof lastName !== 'string') ||
      typeof isActive !== 'boolean' ||
      !Array.isArray(courses)
    ) {
      throw new Error(`Account ${index + 1} has an invalid response shape.`);
    }

    return {
      entityKey: account.entityKey,
      firstName,
      lastName,
      isActive,
      courses,
    };
  });
}

export async function getCourses(
  token: string,
  accountKey: string,
): Promise<Course[]> {
  const response = await authorizedRequest(
    `/Courses/account/${encodeURIComponent(accountKey)}`,
    token,
  );
  const result: unknown = await response.json();

  if (!Array.isArray(result)) {
    throw new Error('The courses API response was not a list.');
  }

  return result.map((course, index) =>
    parseCourse(course, `Course ${index + 1}`),
  );
}

export async function getMedicines(token: string): Promise<Medicine[]> {
  const response = await authorizedRequest('/Medicines', token);
  const result: unknown = await response.json();

  if (!Array.isArray(result)) {
    throw new Error('The medicines API response was not a list.');
  }

  return result.map((medicine, index) => {
    if (
      !isRecord(medicine) ||
      typeof medicine.entityKey !== 'string' ||
      typeof medicine.isActive !== 'boolean' ||
      (medicine.name !== null && typeof medicine.name !== 'string')
    ) {
      throw new Error(
        `Medicine ${index + 1} has an invalid response shape.`,
      );
    }

    return {
      entityKey: medicine.entityKey,
      isActive: medicine.isActive,
      name: medicine.name,
    };
  });
}

export async function getCourseByKey(
  token: string,
  courseKey: string,
): Promise<Course> {
  const response = await authorizedRequest(
    `/Courses/${encodeURIComponent(courseKey)}`,
    token,
  );
  const result: unknown = await response.json();

  if (!isRecord(result) || !Array.isArray(result.prescriptionSchedules)) {
    throw new Error(
      'The course API response did not include a prescriptionSchedules list.',
    );
  }

  const course = parseCourse(result, 'Course');

  if (course.entityKey.toLowerCase() !== courseKey.toLowerCase()) {
    throw new Error('The requested course was not returned by the API.');
  }

  return course;
}

export async function createCourse(
  token: string,
  request: CreateCourseRequest,
): Promise<void> {
  await authorizedRequest('/Courses', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
}

export async function deleteCourse(
  token: string,
  courseKey: string,
): Promise<void> {
  await authorizedRequest(
    `/Courses/${encodeURIComponent(courseKey)}`,
    token,
    { method: 'DELETE' },
  );
}

export async function createPrescriptionSchedule(
  token: string,
  request: CreatePrescriptionScheduleRequest,
): Promise<PrescriptionSchedule> {
  const response = await authorizedRequest('/PrescriptionSchedules', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const result: unknown = await response.json();
  return parsePrescriptionSchedule(result, 'Prescription schedule');
}

export async function deletePrescriptionSchedule(
  token: string,
  scheduleKey: string,
): Promise<void> {
  await authorizedRequest(
    `/PrescriptionSchedules/${encodeURIComponent(scheduleKey)}`,
    token,
    { method: 'DELETE' },
  );
}

export async function takeDose(
  token: string,
  request: TakeDoseRequest,
): Promise<void> {
  await authorizedRequest('/Doses/Take', token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
}
