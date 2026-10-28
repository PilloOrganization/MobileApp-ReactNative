import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {
  PanResponderGestureState,
  TextInputInstance,
} from 'react-native';
import type { ReactNode } from 'react';
import {
  createAccount,
  createCourse,
  createPrescriptionSchedule,
  deleteAccount,
  deleteCourse,
  deletePrescriptionSchedule,
  getAccounts,
  getCourseByKey,
  getCourses,
  getMedicines,
  loginUser,
  registerUser,
  takeDose,
} from './src/api';
import type { Account, Course, Dose, Medicine } from './src/api';

function getLocalDateInputValue(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDailyDoseTimes(value: string): string[] | null {
  const times = value
    .split(',')
    .map((time) => time.trim())
    .filter(Boolean);

  if (
    times.length === 0 ||
    times.some(
      (time) =>
        !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time),
    )
  ) {
    return null;
  }

  return [...new Set(times.map((time) => (time.length === 5 ? `${time}:00` : time)))];
}

function formatDoseTime(value: string): string {
  const dateTime = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/.exec(value);
  if (dateTime) {
    return dateTime[1];
  }

  const timeOnly = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  if (timeOnly) {
    return `${timeOnly[1]}:${timeOnly[2]}`;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface DoseDayGroup {
  dateKey: string;
  dayName: string;
  dateLabel: string;
  doses: Dose[];
}

function groupDosesByDay(doses: Dose[]): DoseDayGroup[] {
  const groups = new Map<string, Dose[]>();

  for (const dose of doses) {
    const dateKey = dose.time.slice(0, 10);
    const dayDoses = groups.get(dateKey) ?? [];
    dayDoses.push(dose);
    groups.set(dateKey, dayDoses);
  }

  return [...groups.entries()]
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([dateKey, dayDoses]) => {
      const [year, month, day] = dateKey.split('-').map(Number);
      const date = new Date(year, month - 1, day);

      return {
        dateKey,
        dayName: date.toLocaleDateString(undefined, { weekday: 'long' }),
        dateLabel: date.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        doses: dayDoses.sort((doseA, doseB) =>
          doseA.time.localeCompare(doseB.time),
        ),
      };
    });
}

function isValidDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const ACCOUNT_DELETE_ACTION_WIDTH = 76;
type SwipePanHandlers = ReturnType<typeof PanResponder.create>['panHandlers'];

function SwipeToDeleteRow({
  canDelete,
  children,
  deleteLabel = 'Delete account',
  onDelete,
}: {
  canDelete: boolean;
  children: ReactNode | ((panHandlers: SwipePanHandlers) => ReactNode);
  deleteLabel?: string;
  onDelete: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);
  const startX = useRef(0);
  const canDeleteRef = useRef(canDelete);
  const onDeleteRef = useRef(onDelete);
  canDeleteRef.current = canDelete;
  onDeleteRef.current = onDelete;

  useEffect(() => {
    if (!canDelete) {
      isOpen.current = false;
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
      }).start();
    }
  }, [canDelete, translateX]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        canDeleteRef.current &&
        Math.abs(gestureState.dx) > 8 &&
        Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
      onPanResponderGrant: () => {
        startX.current = isOpen.current ? -ACCOUNT_DELETE_ACTION_WIDTH : 0;
      },
      onPanResponderMove: (_, gestureState) => {
        translateX.setValue(
          Math.max(
            -ACCOUNT_DELETE_ACTION_WIDTH,
            Math.min(0, startX.current + gestureState.dx),
          ),
        );
      },
      onPanResponderRelease: (_, gestureState) => {
        const shouldOpen =
          startX.current + gestureState.dx < -ACCOUNT_DELETE_ACTION_WIDTH / 2;
        isOpen.current = shouldOpen;
        Animated.spring(translateX, {
          toValue: shouldOpen ? -ACCOUNT_DELETE_ACTION_WIDTH : 0,
          useNativeDriver: true,
        }).start();
      },
      onPanResponderTerminate: () => {
        isOpen.current = false;
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  return (
    <View style={styles.swipeRow}>
      {canDelete ? (
        <Pressable
          accessibilityLabel={deleteLabel}
          accessibilityRole="button"
          onPress={() => onDeleteRef.current()}
          style={styles.swipeDeleteAction}
        >
          <View style={styles.trashIconLid} />
          <View style={styles.trashIconBody} />
        </Pressable>
      ) : null}
      <Animated.View
        {...(typeof children === 'function' ? {} : panResponder.panHandlers)}
        style={[
          styles.swipeForeground,
          { transform: [{ translateX }] },
        ]}
      >
        {typeof children === 'function'
          ? children(panResponder.panHandlers)
          : children}
      </Animated.View>
    </View>
  );
}

function DeleteConfirmationModal({
  visible,
  title,
  isBusy,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={() => {
        if (!isBusy) {
          onCancel();
        }
      }}
      transparent
      visible={visible}
    >
      <View style={styles.deleteModalBackdrop}>
        <View style={styles.deleteModalCard}>
          <Text style={styles.deleteModalTitle}>{title}</Text>
          <View style={styles.deleteActions}>
            <Pressable
              accessibilityRole="button"
              disabled={isBusy}
              onPress={onCancel}
              style={styles.cancelDeleteButton}
            >
              <Text style={styles.cancelDeleteText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={isBusy}
              onPress={onConfirm}
              style={[styles.deleteButton, isBusy && styles.buttonDisabled]}
            >
              {isBusy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.deleteButtonText}>Delete</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SwipeBackScreen({
  children,
  onSwipeBack,
}: {
  children: ReactNode;
  onSwipeBack: () => void;
}) {
  const backGestureEdgeWidth = Math.min(
    96,
    Dimensions.get('window').width * 0.24,
  );
  const onSwipeBackRef = useRef(onSwipeBack);
  onSwipeBackRef.current = onSwipeBack;
  const shouldStartBackGesture = (gestureState: PanResponderGestureState) =>
    gestureState.x0 >=
      Dimensions.get('window').width - backGestureEdgeWidth &&
    gestureState.dx < -8 &&
    Math.abs(gestureState.dx) > Math.abs(gestureState.dy);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        shouldStartBackGesture(gestureState),
      onMoveShouldSetPanResponderCapture: (_, gestureState) =>
        shouldStartBackGesture(gestureState),
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx <= -55 || gestureState.vx <= -0.5) {
          onSwipeBackRef.current();
        }
      },
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  return (
    <View {...panResponder.panHandlers} style={styles.flex}>
      {children}
    </View>
  );
}

export default function App() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [defaultAccountKey, setDefaultAccountKey] = useState<string | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isAccountsLoading, setIsAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState('');
  const [accountsNotice, setAccountsNotice] = useState('');
  const [isCreateAccountOpen, setIsCreateAccountOpen] = useState(false);
  const [newAccountFirstName, setNewAccountFirstName] = useState('');
  const [newAccountLastName, setNewAccountLastName] = useState('');
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [confirmDeleteAccountKey, setConfirmDeleteAccountKey] = useState<
    string | null
  >(null);
  const [deletingAccountKey, setDeletingAccountKey] = useState<string | null>(
    null,
  );
  const [selectedAccountKey, setSelectedAccountKey] = useState<string | null>(
    null,
  );
  const [courses, setCourses] = useState<Course[]>([]);
  const [isCoursesLoading, setIsCoursesLoading] = useState(false);
  const [coursesError, setCoursesError] = useState('');
  const [coursesNotice, setCoursesNotice] = useState('');
  const [isCreateCourseOpen, setIsCreateCourseOpen] = useState(false);
  const [newCourseName, setNewCourseName] = useState('');
  const [isCreatingCourse, setIsCreatingCourse] = useState(false);
  const [confirmDeleteCourseKey, setConfirmDeleteCourseKey] = useState<
    string | null
  >(null);
  const [deletingCourseKey, setDeletingCourseKey] = useState<string | null>(
    null,
  );
  const [selectedCourseKey, setSelectedCourseKey] = useState<string | null>(
    null,
  );
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [isCourseLoading, setIsCourseLoading] = useState(false);
  const [courseDetailError, setCourseDetailError] = useState('');
  const [isCreateScheduleOpen, setIsCreateScheduleOpen] = useState(false);
  const [newMedicineName, setNewMedicineName] = useState('');
  const [selectedMedicineKey, setSelectedMedicineKey] = useState<
    string | null
  >(null);
  const [isMedicineConfirmed, setIsMedicineConfirmed] = useState(false);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [isMedicinesLoading, setIsMedicinesLoading] = useState(false);
  const [medicinesError, setMedicinesError] = useState('');
  const [showMedicineSuggestions, setShowMedicineSuggestions] =
    useState(false);
  const [scheduleStartDate, setScheduleStartDate] = useState(
    getLocalDateInputValue,
  );
  const [scheduleDuration, setScheduleDuration] = useState('7');
  const [dailyDoseTimesInput, setDailyDoseTimesInput] = useState('08:00');
  const [isCreatingSchedule, setIsCreatingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleNotice, setScheduleNotice] = useState('');
  const [confirmDeleteScheduleKey, setConfirmDeleteScheduleKey] = useState<
    string | null
  >(null);
  const [deletingScheduleKey, setDeletingScheduleKey] = useState<string | null>(
    null,
  );
  const [takingDoseKey, setTakingDoseKey] = useState<string | null>(null);
  const scheduleDurationInput = useRef<TextInputInstance>(null);
  const accountRequestId = useRef(0);
  const courseRequestId = useRef(0);
  const courseDetailRequestId = useRef(0);
  const medicinesRequestId = useRef(0);

  const medicineQuery = newMedicineName.trim().toLocaleLowerCase();
  const filteredMedicines = medicineQuery
    ? medicines.filter(
        (medicine) =>
          medicine.isActive &&
          medicine.name
            ?.toLocaleLowerCase()
            .includes(medicineQuery),
      )
    : [];

  const loadAccounts = useCallback(async (token: string) => {
    const requestId = ++accountRequestId.current;
    setIsAccountsLoading(true);
    setAccountsError('');

    try {
      const result = await getAccounts(token);
      if (requestId === accountRequestId.current) {
        setAccounts(result);
      }
    } catch (error) {
      if (requestId === accountRequestId.current) {
        setAccountsError(
          error instanceof Error ? error.message : 'Unable to load accounts.',
        );
      }
    } finally {
      if (requestId === accountRequestId.current) {
        setIsAccountsLoading(false);
      }
    }
  }, []);

  const loadCourses = useCallback(
    async (token: string, accountKey: string): Promise<boolean> => {
      const requestId = ++courseRequestId.current;
      setIsCoursesLoading(true);
      setCoursesError('');
      setCoursesNotice('');

      try {
        const result = await getCourses(token, accountKey);
        if (requestId === courseRequestId.current) {
          setCourses(result);
          return true;
        }
        return false;
      } catch (error) {
        if (requestId === courseRequestId.current) {
          setCoursesError(
            error instanceof Error ? error.message : 'Unable to load courses.',
          );
        }
        return false;
      } finally {
        if (requestId === courseRequestId.current) {
          setIsCoursesLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;

    Promise.all([
      SecureStore.getItemAsync('auth-token'),
      SecureStore.getItemAsync('default-account-key'),
    ])
      .then(([token, savedDefaultAccountKey]) => {
        if (active) {
          setAuthToken(token);
          setDefaultAccountKey(savedDefaultAccountKey);
          if (token) {
            void loadAccounts(token);
          }
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Unable to read the saved sign-in session.',
          );
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [loadAccounts]);

  async function submit() {
    setErrorMessage('');
    setNotice('');

    if (mode === 'register') {
      if (!username.trim() || !password || !confirmPassword) {
        setErrorMessage('Enter a username and both password fields.');
        return;
      }
      if (!email.trim() && !phoneNumber.trim()) {
        setErrorMessage('Enter an email address or phone number.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMessage('The passwords do not match.');
        return;
      }
    } else if (!identifier.trim() || !password) {
      setErrorMessage('Enter your username, email, or phone number and password.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'register') {
        await registerUser({
          username: username.trim(),
          ...(phoneNumber.trim() ? { phoneNumber: phoneNumber.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
          password,
          confirmPassword,
        });
        setIdentifier(email.trim() || phoneNumber.trim() || username.trim());
        setPassword('');
        setConfirmPassword('');
        setMode('login');
        setNotice('Registration complete. Sign in with your new account.');
      } else {
        const result = await loginUser({
          usernameOrPhoneOrEmail: identifier.trim(),
          password,
        });
        await SecureStore.setItemAsync('auth-token', result.token);
        const accountKey = result.defaultAccount?.entityKey ?? null;
        setDefaultAccountKey(accountKey);
        setAuthToken(result.token);
        void loadAccounts(result.token);
        try {
          if (accountKey) {
            await SecureStore.setItemAsync('default-account-key', accountKey);
          } else {
            await SecureStore.deleteItemAsync('default-account-key');
          }
        } catch (error) {
          setErrorMessage(
            error instanceof Error
              ? `Signed in, but couldn't save the default account: ${error.message}`
              : "Signed in, but couldn't save the default account.",
          );
        }
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Something went wrong.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitNewAccount() {
    if (!authToken || isCreatingAccount) {
      return;
    }

    setAccountsError('');
    setAccountsNotice('');
    setIsCreatingAccount(true);

    try {
      await createAccount(authToken, {
        firstName: newAccountFirstName.trim() || null,
        lastName: newAccountLastName.trim() || null,
      });
      setNewAccountFirstName('');
      setNewAccountLastName('');
      setIsCreateAccountOpen(false);
      await loadAccounts(authToken);
    } catch (error) {
      setAccountsError(
        error instanceof Error ? error.message : 'Unable to add account.',
      );
    } finally {
      setIsCreatingAccount(false);
    }
  }

  async function confirmDeleteAccount() {
    if (
      !authToken ||
      !confirmDeleteAccountKey ||
      confirmDeleteAccountKey === defaultAccountKey ||
      deletingAccountKey
    ) {
      return;
    }

    const accountKey = confirmDeleteAccountKey;
    setAccountsError('');
    setAccountsNotice('');
    setDeletingAccountKey(accountKey);

    try {
      await deleteAccount(authToken, accountKey);
      setConfirmDeleteAccountKey(null);
      await loadAccounts(authToken);
    } catch (error) {
      setAccountsError(
        error instanceof Error ? error.message : 'Unable to delete account.',
      );
    } finally {
      setDeletingAccountKey(null);
    }
  }

  async function submitNewCourse() {
    if (!authToken || !selectedAccountKey || isCreatingCourse) {
      return;
    }

    const name = newCourseName.trim();
    if (!name) {
      setCoursesError('Enter a course name.');
      return;
    }

    setCoursesError('');
    setCoursesNotice('');
    setIsCreatingCourse(true);

    try {
      await createCourse(authToken, {
        accountKey: selectedAccountKey,
        name,
      });
      setNewCourseName('');
      setIsCreateCourseOpen(false);
      await loadCourses(authToken, selectedAccountKey);
    } catch (error) {
      setCoursesError(
        error instanceof Error ? error.message : 'Unable to add course.',
      );
    } finally {
      setIsCreatingCourse(false);
    }
  }

  async function confirmDeleteCourse() {
    if (
      !authToken ||
      !confirmDeleteCourseKey ||
      selectedCourseKey === confirmDeleteCourseKey ||
      deletingCourseKey
    ) {
      return;
    }

    const courseKey = confirmDeleteCourseKey;
    setCoursesError('');
    setCoursesNotice('');
    setDeletingCourseKey(courseKey);

    try {
      await deleteCourse(authToken, courseKey);
      setConfirmDeleteCourseKey(null);
      if (selectedAccountKey) {
        await loadCourses(authToken, selectedAccountKey);
      }
      await loadAccounts(authToken);
    } catch (error) {
      setCoursesError(
        error instanceof Error ? error.message : 'Unable to delete course.',
      );
    } finally {
      setDeletingCourseKey(null);
    }
  }

  async function submitPrescriptionSchedule() {
    if (!authToken || !selectedCourseKey || isCreatingSchedule) {
      return;
    }

    const medicineName = newMedicineName.trim();
    const durationInDays = Number(scheduleDuration);
    const dailyDoseTimes = parseDailyDoseTimes(dailyDoseTimesInput);

    if (!medicineName) {
      setScheduleError('Enter a medicine name.');
      return;
    }
    if (!isMedicineConfirmed) {
      setScheduleError(
        'Select a medicine or choose to use the entered name as a new medicine.',
      );
      setShowMedicineSuggestions(true);
      return;
    }
    if (!Number.isSafeInteger(durationInDays) || durationInDays < 1) {
      setScheduleError('Enter a duration of at least one day.');
      return;
    }
    if (!isValidDateInput(scheduleStartDate)) {
      setScheduleError('Enter a valid start date in YYYY-MM-DD format.');
      return;
    }
    if (!dailyDoseTimes) {
      setScheduleError(
        'Enter one or more valid times, separated by commas (for example 08:00, 20:00).',
      );
      return;
    }

    setScheduleError('');
    setScheduleNotice('');
    setIsCreatingSchedule(true);

    try {
      const createdSchedule = await createPrescriptionSchedule(authToken, {
        courseKey: selectedCourseKey,
        medicineName,
        medicineKey: selectedMedicineKey,
        durationInDays,
        startDate: scheduleStartDate,
        dailyDoseTimes,
      });
      setSelectedCourse((course) =>
        course
          ? {
              ...course,
              prescriptionSchedules: [
                createdSchedule,
                ...(course.prescriptionSchedules ?? []),
              ],
            }
          : course,
      );
      setNewMedicineName('');
      setSelectedMedicineKey(null);
      setIsMedicineConfirmed(false);
      setShowMedicineSuggestions(false);
      setIsCreateScheduleOpen(false);
    } catch (error) {
      setScheduleError(
        error instanceof Error
          ? error.message
          : 'Unable to create prescription schedule.',
      );
    } finally {
      setIsCreatingSchedule(false);
    }
  }

  async function openCreateScheduleForm() {
    if (isCreateScheduleOpen) {
      medicinesRequestId.current += 1;
      setIsMedicinesLoading(false);
      setIsCreateScheduleOpen(false);
      setShowMedicineSuggestions(false);
      return;
    }

    if (!authToken) {
      setMedicinesError('You must be signed in to load medicines.');
      return;
    }

    setScheduleError('');
    setScheduleNotice('');
    setMedicinesError('');
    setMedicines([]);
    setNewMedicineName('');
    setSelectedMedicineKey(null);
    setIsMedicineConfirmed(false);
    setIsCreateScheduleOpen(true);
    setIsMedicinesLoading(true);
    const requestId = ++medicinesRequestId.current;

    try {
      const result = await getMedicines(authToken);
      if (requestId === medicinesRequestId.current) {
        setMedicines(result);
      }
    } catch (error) {
      if (requestId === medicinesRequestId.current) {
        setMedicinesError(
          error instanceof Error ? error.message : 'Unable to load medicines.',
        );
      }
    } finally {
      if (requestId === medicinesRequestId.current) {
        setIsMedicinesLoading(false);
      }
    }
  }

  function chooseMedicine(medicine: Medicine) {
    if (!medicine.name || !medicine.isActive) {
      return;
    }
    setNewMedicineName(medicine.name);
    setSelectedMedicineKey(medicine.entityKey);
    setIsMedicineConfirmed(true);
    setShowMedicineSuggestions(false);
    scheduleDurationInput.current?.focus();
  }

  function useNewMedicineName() {
    if (!newMedicineName.trim()) {
      return;
    }
    setSelectedMedicineKey(null);
    setIsMedicineConfirmed(true);
    setShowMedicineSuggestions(false);
    scheduleDurationInput.current?.focus();
  }

  async function confirmDeletePrescriptionSchedule() {
    if (
      !authToken ||
      !confirmDeleteScheduleKey ||
      deletingScheduleKey ||
      takingDoseKey ||
      !selectedCourse
    ) {
      return;
    }

    const scheduleKey = confirmDeleteScheduleKey;
    setScheduleError('');
    setScheduleNotice('');
    setDeletingScheduleKey(scheduleKey);

    try {
      await deletePrescriptionSchedule(authToken, scheduleKey);
      setSelectedCourse((course) =>
        course
          ? {
              ...course,
              prescriptionSchedules: (
                course.prescriptionSchedules ?? []
              ).filter((schedule) => schedule.entityKey !== scheduleKey),
            }
          : course,
      );
      setConfirmDeleteScheduleKey(null);
    } catch (error) {
      setScheduleError(
        error instanceof Error
          ? error.message
          : 'Unable to delete prescription schedule.',
      );
    } finally {
      setDeletingScheduleKey(null);
    }
  }

  async function toggleDoseTaken(
    scheduleKey: string,
    dose: Dose,
  ): Promise<void> {
    if (!authToken || takingDoseKey) {
      return;
    }

    const takeUntake = !dose.isTaken;
    setScheduleError('');
    setScheduleNotice('');
    setTakingDoseKey(dose.entityKey);

    try {
      await takeDose(authToken, {
        doseKey: dose.entityKey,
        takeUntake,
      });
      setSelectedCourse((course) =>
        course
          ? {
              ...course,
              prescriptionSchedules: (
                course.prescriptionSchedules ?? []
              ).map((schedule) =>
                schedule.entityKey === scheduleKey
                  ? {
                      ...schedule,
                      doses: schedule.doses.map((currentDose) =>
                        currentDose.entityKey === dose.entityKey
                          ? { ...currentDose, isTaken: takeUntake }
                          : currentDose,
                      ),
                    }
                  : schedule,
              ),
            }
          : course,
      );
    } catch (error) {
      setScheduleError(
        error instanceof Error ? error.message : 'Unable to update dose.',
      );
    } finally {
      setTakingDoseKey(null);
    }
  }

  function renderExpandedCourse(courseKey: string) {
    if (selectedCourseKey !== courseKey) {
      return null;
    }

    return (
      <View style={styles.courseExpansion}>
        {isCourseLoading ? (
          <ActivityIndicator color="#3157D5" style={styles.accountLoader} />
        ) : null}
        {courseDetailError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {courseDetailError}
          </Text>
        ) : null}
        {selectedCourse?.entityKey === courseKey ? (
          <>
            <View style={[styles.sectionHeader, styles.addButtonHeader]}>
              <Pressable
                accessibilityLabel={
                  isCreateScheduleOpen
                    ? 'Close prescription schedule form'
                    : 'Add prescription schedule'
                }
                accessibilityRole="button"
                disabled={isCreatingSchedule}
                onPress={() => void openCreateScheduleForm()}
                style={styles.addAccountButton}
              >
                <Text style={styles.addAccountButtonText}>+</Text>
              </Pressable>
            </View>
            {isCreateScheduleOpen ? (
              <View style={styles.accountForm}>
                <Text style={styles.accountFormTitle}>
                  New prescription schedule
                </Text>
                <TextInput
                  autoCapitalize="words"
                  onChangeText={(value) => {
                    setNewMedicineName(value);
                    setSelectedMedicineKey(null);
                    setIsMedicineConfirmed(false);
                    setShowMedicineSuggestions(true);
                  }}
                  onFocus={() => setShowMedicineSuggestions(true)}
                  placeholder="Medicine name"
                  placeholderTextColor="#8790A3"
                  returnKeyType="next"
                  style={styles.input}
                  value={newMedicineName}
                />
                {isMedicinesLoading ? (
                  <ActivityIndicator
                    color="#3157D5"
                    style={styles.medicineLoader}
                  />
                ) : null}
                {medicinesError ? (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {medicinesError}
                  </Text>
                ) : null}
                {showMedicineSuggestions && medicineQuery ? (
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                    style={styles.medicineSuggestions}
                  >
                    {filteredMedicines.map((medicine) => (
                      <Pressable
                        accessibilityRole="button"
                        key={medicine.entityKey}
                        onPress={() => chooseMedicine(medicine)}
                        style={styles.medicineSuggestion}
                      >
                        <Text style={styles.medicineSuggestionText}>
                          {medicine.name}
                        </Text>
                      </Pressable>
                    ))}
                    <Pressable
                      accessibilityRole="button"
                      onPress={useNewMedicineName}
                      style={styles.medicineSuggestion}
                    >
                      <Text style={styles.newMedicineSuggestionText}>
                        Use “{newMedicineName.trim()}” as a new medicine
                      </Text>
                    </Pressable>
                  </ScrollView>
                ) : null}
                <TextInput
                  autoCapitalize="none"
                  keyboardType="number-pad"
                  onChangeText={setScheduleDuration}
                  placeholder="Duration in days"
                  placeholderTextColor="#8790A3"
                  returnKeyType="next"
                  ref={scheduleDurationInput}
                  style={styles.input}
                  value={scheduleDuration}
                />
                <Text style={styles.fieldLabel}>Start date</Text>
                <TextInput
                  autoCapitalize="none"
                  keyboardType="numbers-and-punctuation"
                  onChangeText={setScheduleStartDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#8790A3"
                  returnKeyType="next"
                  style={styles.input}
                  value={scheduleStartDate}
                />
                <Text style={styles.fieldLabel}>
                  Daily dose times (24-hour clock)
                </Text>
                <TextInput
                  autoCapitalize="none"
                  keyboardType="numbers-and-punctuation"
                  onChangeText={setDailyDoseTimesInput}
                  placeholder="08:00, 20:00"
                  placeholderTextColor="#8790A3"
                  returnKeyType="done"
                  style={styles.input}
                  value={dailyDoseTimesInput}
                />
                <Text style={styles.formHint}>
                  Enter times separated by commas, such as 08:00, 20:00.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={isCreatingSchedule}
                  onPress={submitPrescriptionSchedule}
                  style={[
                    styles.primaryButton,
                    isCreatingSchedule && styles.buttonDisabled,
                  ]}
                >
                  {isCreatingSchedule ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>
                      Create schedule
                    </Text>
                  )}
                </Pressable>
              </View>
            ) : null}
            {scheduleError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {scheduleError}
              </Text>
            ) : null}
            {scheduleNotice ? (
              <Text style={styles.notice}>{scheduleNotice}</Text>
            ) : null}
            {!selectedCourse.prescriptionSchedules?.length ? (
              <Text style={styles.emptyState}>
                No prescription schedules for this course.
              </Text>
            ) : null}
            {(selectedCourse.prescriptionSchedules ?? []).map((schedule) => {
              const days = groupDosesByDay(schedule.doses);

              return (
                <SwipeToDeleteRow
                  canDelete
                  deleteLabel="Delete prescription schedule"
                  key={schedule.entityKey}
                  onDelete={() =>
                    setConfirmDeleteScheduleKey(schedule.entityKey)
                  }
                >
                  {(panHandlers) => (
                    <View style={[styles.accountCard, styles.accountListCard]}>
                      <View {...panHandlers} style={styles.accountCardHeader}>
                        <Text style={styles.accountName} numberOfLines={1}>
                          {schedule.medicine.name || 'Medicine'}
                        </Text>
                        {!schedule.isActive ? (
                          <Text style={styles.inactiveLabel}>Inactive</Text>
                        ) : null}
                      </View>
                      {days.length === 0 ? (
                        <Text style={styles.accountDetail}>
                          No doses scheduled.
                        </Text>
                      ) : (
                        <ScrollView
                          contentContainerStyle={styles.dayStrip}
                          horizontal
                          showsHorizontalScrollIndicator={false}
                        >
                          {days.map((day) => (
                            <View key={day.dateKey} style={styles.dayColumn}>
                              <Text style={styles.dayName}>{day.dayName}</Text>
                              <Text style={styles.dayDate}>
                                {day.dateLabel}
                              </Text>
                              {day.doses.map((dose) => {
                                const isTaking =
                                  takingDoseKey === dose.entityKey;

                                return (
                                  <Pressable
                                    accessibilityLabel={`${day.dayName}, ${day.dateLabel}, ${formatDoseTime(dose.time)}, ${dose.isTaken ? 'taken' : 'not taken'}`}
                                    accessibilityRole="button"
                                    disabled={
                                      Boolean(takingDoseKey) ||
                                      Boolean(deletingScheduleKey)
                                    }
                                    key={dose.entityKey}
                                    onPress={() =>
                                      void toggleDoseTaken(
                                        schedule.entityKey,
                                        dose,
                                      )
                                    }
                                    style={[
                                      styles.doseButton,
                                      dose.isTaken && styles.doseButtonTaken,
                                    ]}
                                  >
                                    {isTaking ? (
                                      <ActivityIndicator color="#3157D5" />
                                    ) : (
                                      <Text style={styles.doseButtonTime}>
                                        {formatDoseTime(dose.time)}
                                      </Text>
                                    )}
                                  </Pressable>
                                );
                              })}
                            </View>
                          ))}
                        </ScrollView>
                      )}
                    </View>
                  )}
                </SwipeToDeleteRow>
              );
            })}
          </>
        ) : null}
      </View>
    );
  }

  function openAccountCourses(accountKey: string) {
    if (!authToken) {
      return;
    }

    setSelectedAccountKey(accountKey);
    setCourses([]);
    setCoursesError('');
    setCoursesNotice('');
    setIsCreateCourseOpen(false);
    setConfirmDeleteCourseKey(null);
    setSelectedCourseKey(null);
    setSelectedCourse(null);
    setIsCourseLoading(false);
    setCourseDetailError('');
    courseDetailRequestId.current += 1;
    void loadCourses(authToken, accountKey);
  }

  async function openCourse(courseKey: string) {
    if (!authToken) {
      return;
    }

    if (selectedCourseKey === courseKey) {
      returnToCourses();
      return;
    }

    const requestId = ++courseDetailRequestId.current;
    setConfirmDeleteCourseKey(null);
    setSelectedCourseKey(courseKey);
    setSelectedCourse(null);
    setIsCourseLoading(true);
    setCourseDetailError('');
    setIsCreateScheduleOpen(false);
    setNewMedicineName('');
    setScheduleStartDate(getLocalDateInputValue());
    setScheduleDuration('7');
    setDailyDoseTimesInput('08:00');
    setScheduleError('');
    setScheduleNotice('');
    setConfirmDeleteScheduleKey(null);

    try {
      const result = await getCourseByKey(authToken, courseKey);
      if (requestId === courseDetailRequestId.current) {
        setSelectedCourse(result);
      }
    } catch (error) {
      if (requestId === courseDetailRequestId.current) {
        setCourseDetailError(
          error instanceof Error ? error.message : 'Unable to load course.',
        );
      }
    } finally {
      if (requestId === courseDetailRequestId.current) {
        setIsCourseLoading(false);
      }
    }
  }

  function returnToCourses() {
    courseDetailRequestId.current += 1;
    setSelectedCourseKey(null);
    setSelectedCourse(null);
    setIsCourseLoading(false);
    setCourseDetailError('');
    setIsCreateScheduleOpen(false);
    setConfirmDeleteScheduleKey(null);
    setNewMedicineName('');
    setScheduleError('');
    setScheduleNotice('');
  }

  function returnToAccounts() {
    courseRequestId.current += 1;
    setSelectedAccountKey(null);
    setCourses([]);
    setCoursesError('');
    setCoursesNotice('');
    setIsCoursesLoading(false);
    setIsCreateCourseOpen(false);
    setNewCourseName('');
    setConfirmDeleteCourseKey(null);
    returnToCourses();
  }

  async function signOut() {
    setErrorMessage('');
    try {
      await Promise.all([
        SecureStore.deleteItemAsync('auth-token'),
        SecureStore.deleteItemAsync('default-account-key'),
      ]);
      setAuthToken(null);
      setDefaultAccountKey(null);
      setPassword('');
      setAccounts([]);
      setAccountsError('');
      setAccountsNotice('');
      setIsCreateAccountOpen(false);
      setConfirmDeleteAccountKey(null);
      returnToAccounts();
      accountRequestId.current += 1;
      setIsAccountsLoading(false);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to sign out.',
      );
    }
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#3157D5" />
      </SafeAreaView>
    );
  }

  if (authToken) {
    const selectedAccount = accounts.find(
      (account) => account.entityKey === selectedAccountKey,
    );
    if (selectedCourseKey && !selectedAccountKey) {
      return (
        <SwipeBackScreen onSwipeBack={returnToCourses}>
        <SafeAreaView style={styles.screen}>
          <StatusBar style="dark" />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.flex}
          >
            <ScrollView
              contentContainerStyle={styles.accountContent}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.accountScreenHeader}>
                <Pressable
                  accessibilityLabel="Back to courses"
                  accessibilityRole="button"
                  disabled={isCreatingSchedule}
                  onPress={returnToCourses}
                  style={styles.backButton}
                >
                  <Text style={styles.backButtonText}>‹ Courses</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={signOut}
                  style={styles.signOutButton}
                >
                  <Text style={styles.signOutButtonText}>Sign out</Text>
                </Pressable>
              </View>
              <Text style={styles.sectionTitle}>
                {selectedCourse?.name ||
                  (isCourseLoading ? 'Loading course…' : 'Course')}
              </Text>
              {isCourseLoading ? (
                <ActivityIndicator
                  size="large"
                  color="#3157D5"
                  style={styles.accountLoader}
                />
              ) : null}
              {courseDetailError ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {courseDetailError}
                </Text>
              ) : null}
              {selectedCourse ? (
                <>
              <View style={[styles.sectionHeader, styles.addButtonHeader]}>
                <Pressable
                  accessibilityLabel={
                    isCreateScheduleOpen
                      ? 'Close prescription schedule form'
                      : 'Add prescription schedule'
                  }
                  accessibilityRole="button"
                  disabled={isCreatingSchedule}
                  onPress={() => void openCreateScheduleForm()}
                  style={styles.addAccountButton}
                >
                  <Text style={styles.addAccountButtonText}>+</Text>
                </Pressable>
              </View>
              {isCreateScheduleOpen ? (
                <View style={styles.accountForm}>
                  <Text style={styles.accountFormTitle}>
                    New prescription schedule
                  </Text>
                  <TextInput
                    autoCapitalize="words"
                    onChangeText={(value) => {
                      setNewMedicineName(value);
                      setSelectedMedicineKey(null);
                      setIsMedicineConfirmed(false);
                      setShowMedicineSuggestions(true);
                    }}
                    onFocus={() => setShowMedicineSuggestions(true)}
                    placeholder="Medicine name"
                    placeholderTextColor="#8790A3"
                    returnKeyType="next"
                    style={styles.input}
                    value={newMedicineName}
                  />
                  {isMedicinesLoading ? (
                    <ActivityIndicator
                      color="#3157D5"
                      style={styles.medicineLoader}
                    />
                  ) : null}
                  {medicinesError ? (
                    <Text accessibilityRole="alert" style={styles.error}>
                      {medicinesError}
                    </Text>
                  ) : null}
                  {showMedicineSuggestions && medicineQuery ? (
                    <ScrollView
                      keyboardShouldPersistTaps="handled"
                      nestedScrollEnabled
                      style={styles.medicineSuggestions}
                    >
                      {filteredMedicines.map((medicine) => (
                        <Pressable
                          accessibilityRole="button"
                          key={medicine.entityKey}
                          onPress={() => chooseMedicine(medicine)}
                          style={styles.medicineSuggestion}
                        >
                          <Text style={styles.medicineSuggestionText}>
                            {medicine.name}
                          </Text>
                        </Pressable>
                      ))}
                      <Pressable
                        accessibilityRole="button"
                        onPress={useNewMedicineName}
                        style={styles.medicineSuggestion}
                      >
                        <Text style={styles.newMedicineSuggestionText}>
                          Use “{newMedicineName.trim()}” as a new medicine
                        </Text>
                      </Pressable>
                    </ScrollView>
                  ) : null}
                  <TextInput
                    autoCapitalize="none"
                    keyboardType="number-pad"
                    onChangeText={setScheduleDuration}
                    placeholder="Duration in days"
                    placeholderTextColor="#8790A3"
                    returnKeyType="next"
                    ref={scheduleDurationInput}
                    style={styles.input}
                    value={scheduleDuration}
                  />
                  <Text style={styles.fieldLabel}>Start date</Text>
                  <TextInput
                    autoCapitalize="none"
                    keyboardType="numbers-and-punctuation"
                    onChangeText={setScheduleStartDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#8790A3"
                    returnKeyType="next"
                    style={styles.input}
                    value={scheduleStartDate}
                  />
                  <Text style={styles.fieldLabel}>
                    Daily dose times (24-hour clock)
                  </Text>
                  <TextInput
                    autoCapitalize="none"
                    keyboardType="numbers-and-punctuation"
                    onChangeText={setDailyDoseTimesInput}
                    placeholder="08:00, 20:00"
                    placeholderTextColor="#8790A3"
                    returnKeyType="done"
                    style={styles.input}
                    value={dailyDoseTimesInput}
                  />
                  <Text style={styles.formHint}>
                    Enter times separated by commas, such as 08:00, 20:00.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isCreatingSchedule}
                    onPress={submitPrescriptionSchedule}
                    style={[
                      styles.primaryButton,
                      isCreatingSchedule && styles.buttonDisabled,
                    ]}
                  >
                    {isCreatingSchedule ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.primaryButtonText}>
                        Create schedule
                      </Text>
                    )}
                  </Pressable>
                </View>
              ) : null}
              {scheduleError ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {scheduleError}
                </Text>
              ) : null}
              {scheduleNotice ? (
                <Text style={styles.notice}>{scheduleNotice}</Text>
              ) : null}
              {!selectedCourse.prescriptionSchedules?.length ? (
                <Text style={styles.emptyState}>
                  No prescription schedules for this course.
                </Text>
              ) : null}
              {(selectedCourse.prescriptionSchedules ?? []).map((schedule) => {
                const days = groupDosesByDay(schedule.doses);

                return (
                  <SwipeToDeleteRow
                    canDelete
                    deleteLabel="Delete prescription schedule"
                    key={schedule.entityKey}
                    onDelete={() =>
                      setConfirmDeleteScheduleKey(schedule.entityKey)
                    }
                  >
                    {(panHandlers) => (
                      <View style={[styles.accountCard, styles.accountListCard]}>
                        <View
                          {...panHandlers}
                          style={styles.accountCardHeader}
                        >
                          <Text style={styles.accountName} numberOfLines={1}>
                            {schedule.medicine.name || 'Medicine'}
                          </Text>
                          {!schedule.isActive ? (
                            <Text style={styles.inactiveLabel}>Inactive</Text>
                          ) : null}
                        </View>
                        {days.length === 0 ? (
                          <Text style={styles.accountDetail}>
                            No doses scheduled.
                          </Text>
                        ) : (
                          <ScrollView
                            contentContainerStyle={styles.dayStrip}
                            horizontal
                            showsHorizontalScrollIndicator={false}
                          >
                            {days.map((day) => (
                              <View
                                key={day.dateKey}
                                style={styles.dayColumn}
                              >
                                <Text style={styles.dayName}>{day.dayName}</Text>
                                <Text style={styles.dayDate}>
                                  {day.dateLabel}
                                </Text>
                                {day.doses.map((dose) => {
                                  const isTaking =
                                    takingDoseKey === dose.entityKey;

                                  return (
                                    <Pressable
                                      accessibilityLabel={`${day.dayName}, ${day.dateLabel}, ${formatDoseTime(dose.time)}, ${dose.isTaken ? 'taken' : 'not taken'}`}
                                      accessibilityRole="button"
                                      disabled={
                                        Boolean(takingDoseKey) ||
                                        Boolean(deletingScheduleKey)
                                      }
                                      key={dose.entityKey}
                                      onPress={() =>
                                        void toggleDoseTaken(
                                          schedule.entityKey,
                                          dose,
                                        )
                                      }
                                      style={[
                                        styles.doseButton,
                                        dose.isTaken &&
                                          styles.doseButtonTaken,
                                      ]}
                                    >
                                      {isTaking ? (
                                        <ActivityIndicator color="#3157D5" />
                                      ) : (
                                        <Text style={styles.doseButtonTime}>
                                          {formatDoseTime(dose.time)}
                                        </Text>
                                      )}
                                    </Pressable>
                                  );
                                })}
                              </View>
                            ))}
                          </ScrollView>
                        )}
                      </View>
                    )}
                  </SwipeToDeleteRow>
                );
              })}
                </>
              ) : null}
            </ScrollView>
          </KeyboardAvoidingView>
          <DeleteConfirmationModal
            visible={Boolean(confirmDeleteScheduleKey)}
            title="Delete this prescription schedule?"
            isBusy={Boolean(deletingScheduleKey || takingDoseKey)}
            onCancel={() => setConfirmDeleteScheduleKey(null)}
            onConfirm={() => void confirmDeletePrescriptionSchedule()}
          />
        </SafeAreaView>
        </SwipeBackScreen>
      );
    }

    if (selectedAccountKey) {
      const selectedAccountName = selectedAccount
        ? [selectedAccount.firstName, selectedAccount.lastName]
            .filter(Boolean)
            .join(' ')
        : '';

      return (
        <SwipeBackScreen onSwipeBack={returnToAccounts}>
        <SafeAreaView style={styles.screen}>
          <StatusBar style="dark" />
          <ScrollView contentContainerStyle={styles.accountContent}>
            <View style={styles.accountScreenHeader}>
              <Pressable
                accessibilityLabel="Back to accounts"
                accessibilityRole="button"
                onPress={returnToAccounts}
                style={styles.backButton}
              >
                <Text style={styles.backButtonText}>‹ Accounts</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={signOut}
                style={styles.signOutButton}
              >
                <Text style={styles.signOutButtonText}>Sign out</Text>
              </Pressable>
            </View>
            <View style={styles.sectionHeader}>
              <Text
                numberOfLines={1}
                style={[styles.sectionTitle, styles.accountHeadingTitle]}
              >
                {selectedAccountName || 'Account'}
              </Text>
              <Pressable
                accessibilityLabel={
                  isCreateCourseOpen ? 'Close course form' : 'Add course'
                }
                accessibilityRole="button"
                disabled={isCoursesLoading || isCreatingCourse}
                onPress={() => {
                  setCoursesError('');
                  setCoursesNotice('');
                  setIsCreateCourseOpen((open) => !open);
                }}
                style={styles.addAccountButton}
              >
                <Text style={styles.addAccountButtonText}>+</Text>
              </Pressable>
            </View>
            {isCreateCourseOpen ? (
              <View style={styles.accountForm}>
                <Text style={styles.accountFormTitle}>New course</Text>
                <TextInput
                  autoCapitalize="words"
                  onChangeText={setNewCourseName}
                  placeholder="Course name"
                  placeholderTextColor="#8790A3"
                  returnKeyType="done"
                  style={styles.input}
                  value={newCourseName}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={isCreatingCourse}
                  onPress={submitNewCourse}
                  style={[
                    styles.primaryButton,
                    isCreatingCourse && styles.buttonDisabled,
                  ]}
                >
                  {isCreatingCourse ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Save course</Text>
                  )}
                </Pressable>
              </View>
            ) : null}
            {coursesError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {coursesError}
              </Text>
            ) : null}
            {coursesNotice ? (
              <Text style={styles.notice}>{coursesNotice}</Text>
            ) : null}
            {isCoursesLoading && courses.length === 0 ? (
              <ActivityIndicator
                size="large"
                color="#3157D5"
                style={styles.accountLoader}
              />
            ) : null}
            {!isCoursesLoading && !coursesError && courses.length === 0 ? (
              <Text style={styles.emptyState}>No courses yet.</Text>
            ) : null}
            {courses.map((course) => {
              return (
                <SwipeToDeleteRow
                  canDelete={selectedCourseKey !== course.entityKey}
                  key={course.entityKey}
                  onDelete={() => setConfirmDeleteCourseKey(course.entityKey)}
                >
                <View style={[styles.accountCard, styles.accountListCard]}>
                  <View style={styles.accountCardHeader}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{
                        expanded: selectedCourseKey === course.entityKey,
                      }}
                      disabled={isCreatingSchedule}
                      onPress={() => void openCourse(course.entityKey)}
                      style={styles.accountTitleButton}
                    >
                      <Text style={styles.accountName} numberOfLines={1}>
                        {course.name || 'Course'}
                      </Text>
                    </Pressable>
                    {course.isActive === false ? (
                      <Text style={styles.inactiveLabel}>Inactive</Text>
                    ) : null}
                  </View>
                  {renderExpandedCourse(course.entityKey)}
                </View>
                </SwipeToDeleteRow>
              );
            })}
          </ScrollView>
          <DeleteConfirmationModal
            visible={Boolean(confirmDeleteCourseKey || confirmDeleteScheduleKey)}
            title={
              confirmDeleteScheduleKey
                ? 'Delete this prescription schedule?'
                : 'Delete this course?'
            }
            isBusy={Boolean(
              deletingCourseKey || deletingScheduleKey || takingDoseKey,
            )}
            onCancel={() => {
              if (confirmDeleteScheduleKey) {
                setConfirmDeleteScheduleKey(null);
              } else {
                setConfirmDeleteCourseKey(null);
              }
            }}
            onConfirm={() => {
              if (confirmDeleteScheduleKey) {
                void confirmDeletePrescriptionSchedule();
              } else {
                void confirmDeleteCourse();
              }
            }}
          />
        </SafeAreaView>
        </SwipeBackScreen>
      );
    }

    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.accountContent}>
          <View style={styles.accountScreenHeader}>
            <Text style={styles.brand}>PILLO</Text>
            <Pressable
              accessibilityRole="button"
              onPress={signOut}
              style={styles.signOutButton}
            >
              <Text style={styles.signOutButtonText}>Sign out</Text>
            </Pressable>
          </View>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Accounts</Text>
            <Pressable
              accessibilityLabel={
                isCreateAccountOpen ? 'Close account form' : 'Add account'
              }
              accessibilityRole="button"
              disabled={isAccountsLoading || isCreatingAccount}
              onPress={() => {
                setAccountsError('');
                setAccountsNotice('');
                setIsCreateAccountOpen((open) => !open);
              }}
              style={styles.addAccountButton}
            >
              <Text style={styles.addAccountButtonText}>+</Text>
            </Pressable>
          </View>
          {errorMessage ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {errorMessage}
            </Text>
          ) : null}
          {isCreateAccountOpen ? (
            <View style={styles.accountForm}>
              <Text style={styles.accountFormTitle}>New account</Text>
              <TextInput
                autoCapitalize="words"
                onChangeText={setNewAccountFirstName}
                placeholder="First name"
                placeholderTextColor="#8790A3"
                returnKeyType="next"
                style={styles.input}
                value={newAccountFirstName}
              />
              <TextInput
                autoCapitalize="words"
                onChangeText={setNewAccountLastName}
                placeholder="Last name"
                placeholderTextColor="#8790A3"
                returnKeyType="done"
                style={styles.input}
                value={newAccountLastName}
              />
              <Pressable
                accessibilityRole="button"
                disabled={isCreatingAccount}
                onPress={submitNewAccount}
                style={[
                  styles.primaryButton,
                  isCreatingAccount && styles.buttonDisabled,
                ]}
              >
                {isCreatingAccount ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>Save account</Text>
                )}
              </Pressable>
            </View>
          ) : null}
          {accountsError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {accountsError}
            </Text>
          ) : null}
          {accountsNotice ? (
            <Text style={styles.notice}>{accountsNotice}</Text>
          ) : null}
          {isAccountsLoading && accounts.length === 0 ? (
            <ActivityIndicator
              size="large"
              color="#3157D5"
              style={styles.accountLoader}
            />
          ) : null}
          {!isAccountsLoading && !accountsError && accounts.length === 0 ? (
            <Text style={styles.emptyState}>No accounts found.</Text>
          ) : null}
          {!defaultAccountKey && accounts.length > 0 ? (
            <Text style={styles.helperText}>
              The default account could not be identified, so account deletion
              is disabled.
            </Text>
          ) : null}
          {accounts.map((account) => {
            const name = [account.firstName, account.lastName]
              .filter(Boolean)
              .join(' ');
            const isDefault = account.entityKey === defaultAccountKey;

            return (
              <SwipeToDeleteRow
                canDelete={!isDefault && Boolean(defaultAccountKey)}
                key={account.entityKey}
                onDelete={() => setConfirmDeleteAccountKey(account.entityKey)}
              >
                <View style={[styles.accountCard, styles.accountListCard]}>
                  <View style={styles.accountCardHeader}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => openAccountCourses(account.entityKey)}
                      style={styles.accountTitleButton}
                    >
                      <Text style={styles.accountName} numberOfLines={1}>
                        {name || 'Account'}
                      </Text>
                    </Pressable>
                    {isDefault ? (
                      <Text style={styles.defaultLabel}>Default</Text>
                    ) : !account.isActive ? (
                      <Text style={styles.inactiveLabel}>Inactive</Text>
                    ) : null}
                  </View>
                </View>
              </SwipeToDeleteRow>
            );
          })}
        </ScrollView>
        <DeleteConfirmationModal
          visible={Boolean(confirmDeleteAccountKey)}
          title="Delete this account?"
          isBusy={Boolean(deletingAccountKey)}
          onCancel={() => setConfirmDeleteAccountKey(null)}
          onConfirm={() => void confirmDeleteAccount()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.brand}>PILLO</Text>
          <Text style={styles.title}>
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </Text>
          <Text style={styles.description}>
            {mode === 'login'
              ? 'Sign in to manage your medication schedule.'
              : 'Register to get started with Pillo.'}
          </Text>

          <View style={styles.form}>
            {mode === 'login' ? (
              <TextInput
                autoCapitalize="none"
                autoComplete="username"
                onChangeText={setIdentifier}
                placeholder="Username, email, or phone"
                placeholderTextColor="#8790A3"
                style={styles.input}
                value={identifier}
              />
            ) : (
              <>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="username"
                  onChangeText={setUsername}
                  placeholder="Username"
                  placeholderTextColor="#8790A3"
                  style={styles.input}
                  value={username}
                />
                <TextInput
                  autoComplete="tel"
                  keyboardType="phone-pad"
                  onChangeText={setPhoneNumber}
                  placeholder="Phone number (optional)"
                  placeholderTextColor="#8790A3"
                  style={styles.input}
                  value={phoneNumber}
                />
                <TextInput
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  onChangeText={setEmail}
                  placeholder="Email address (optional)"
                  placeholderTextColor="#8790A3"
                  style={styles.input}
                  value={email}
                />
              </>
            )}

            <TextInput
              autoCapitalize="none"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor="#8790A3"
              secureTextEntry
              style={styles.input}
              value={password}
            />

            {mode === 'register' ? (
              <TextInput
                autoCapitalize="none"
                autoComplete="new-password"
                onChangeText={setConfirmPassword}
                placeholder="Confirm password"
                placeholderTextColor="#8790A3"
                secureTextEntry
                style={styles.input}
                value={confirmPassword}
              />
            ) : null}

            {errorMessage ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {errorMessage}
              </Text>
            ) : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={submit}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
                isSubmitting && styles.buttonDisabled,
              ]}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {mode === 'login' ? 'Sign in' : 'Create account'}
                </Text>
              )}
            </Pressable>
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting}
            onPress={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setErrorMessage('');
              setNotice('');
            }}
            style={styles.modeButton}
          >
            <Text style={styles.modeButtonText}>
              {mode === 'login'
                ? "Don't have an account? Register"
                : 'Already registered? Sign in'}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: '#F6F7FB' },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F6F7FB',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 36,
  },
  accountContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 36,
  },
  accountScreenHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  signOutButton: {
    borderColor: '#E1E5EF',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  signOutButtonText: {
    color: '#65708A',
    fontSize: 14,
    fontWeight: '600',
  },
  backButton: {
    paddingVertical: 8,
  },
  backButtonText: {
    color: '#3157D5',
    fontSize: 15,
    fontWeight: '600',
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  addButtonHeader: {
    justifyContent: 'flex-end',
  },
  sectionTitle: {
    color: '#17213A',
    fontSize: 20,
    fontWeight: '700',
  },
  accountHeadingTitle: {
    flex: 1,
    marginRight: 12,
  },
  subsectionTitle: {
    color: '#17213A',
    fontSize: 18,
    fontWeight: '700',
  },
  addAccountButton: {
    alignItems: 'center',
    backgroundColor: '#3157D5',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    marginLeft: 'auto',
    width: 44,
  },
  addAccountButtonText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 32,
  },
  accountForm: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E1E5EF',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
    padding: 16,
  },
  accountFormTitle: {
    color: '#17213A',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 14,
  },
  medicineLoader: {
    marginBottom: 12,
  },
  medicineSuggestions: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E1E5EF',
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
    maxHeight: 220,
    overflow: 'hidden',
  },
  medicineSuggestion: {
    borderBottomColor: '#E1E5EF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  medicineSuggestionText: {
    color: '#17213A',
    fontSize: 15,
  },
  newMedicineSuggestionText: {
    color: '#3157D5',
    fontSize: 14,
    fontWeight: '600',
  },
  fieldLabel: {
    color: '#65708A',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  formHint: {
    color: '#65708A',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  helperText: {
    color: '#65708A',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  accountLoader: {
    marginTop: 30,
  },
  emptyState: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    color: '#65708A',
    fontSize: 15,
    padding: 18,
  },
  accountCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E1E5EF',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    padding: 18,
  },
  accountListCard: {
    marginBottom: 0,
  },
  courseExpansion: {
    borderTopColor: '#E1E5EF',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
    paddingTop: 14,
  },
  swipeRow: {
    borderRadius: 14,
    marginBottom: 12,
    overflow: 'hidden',
  },
  swipeForeground: {
    width: '100%',
  },
  swipeDeleteAction: {
    alignItems: 'center',
    backgroundColor: '#B42318',
    bottom: 0,
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    top: 0,
    width: ACCOUNT_DELETE_ACTION_WIDTH,
  },
  trashIconLid: {
    backgroundColor: '#FFFFFF',
    borderRadius: 1,
    height: 2,
    marginBottom: 2,
    width: 16,
  },
  trashIconBody: {
    borderBottomColor: '#FFFFFF',
    borderBottomWidth: 2,
    borderLeftColor: '#FFFFFF',
    borderLeftWidth: 2,
    borderRightColor: '#FFFFFF',
    borderRightWidth: 2,
    borderTopColor: '#FFFFFF',
    borderTopWidth: 1,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    height: 15,
    width: 12,
  },
  accountCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  accountTitleButton: {
    flex: 1,
  },
  dayStrip: {
    paddingTop: 16,
    paddingRight: 4,
  },
  dayColumn: {
    backgroundColor: '#F6F7FB',
    borderColor: '#E1E5EF',
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 10,
    padding: 12,
    width: 184,
  },
  dayName: {
    color: '#17213A',
    fontSize: 15,
    fontWeight: '700',
  },
  dayDate: {
    color: '#65708A',
    fontSize: 13,
    marginTop: 3,
    marginBottom: 8,
  },
  doseButton: {
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderColor: '#D5DBEA',
    borderRadius: 9,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 54,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  doseButtonTaken: {
    backgroundColor: '#EAF6EF',
    borderColor: '#B9DEC7',
  },
  doseButtonTime: {
    color: '#17213A',
    fontSize: 15,
    fontWeight: '700',
  },
  accountName: {
    color: '#17213A',
    fontSize: 17,
    fontWeight: '700',
  },
  accountDetail: {
    color: '#65708A',
    fontSize: 14,
    marginTop: 8,
  },
  doseTime: {
    backgroundColor: '#F6F7FB',
    borderRadius: 8,
    color: '#17213A',
    fontSize: 14,
    marginTop: 8,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inactiveLabel: {
    color: '#B42318',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 8,
  },
  defaultLabel: {
    color: '#247247',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 8,
  },
  deleteModalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(23, 33, 58, 0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  deleteModalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    maxWidth: 400,
    padding: 20,
    width: '100%',
  },
  deleteModalTitle: {
    color: '#17213A',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 20,
  },
  deleteActions: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelDeleteButton: {
    alignItems: 'center',
    borderColor: '#E1E5EF',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 14,
  },
  cancelDeleteText: {
    color: '#65708A',
    fontSize: 14,
    fontWeight: '600',
  },
  deleteButton: {
    alignItems: 'center',
    backgroundColor: '#B42318',
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 14,
  },
  deleteButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  brand: {
    color: '#3157D5',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 3,
    marginBottom: 20,
  },
  title: {
    color: '#17213A',
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 10,
  },
  description: {
    color: '#65708A',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 30,
  },
  form: {
    marginBottom: 0,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E1E5EF',
    borderRadius: 12,
    borderWidth: 1,
    color: '#17213A',
    fontSize: 16,
    minHeight: 54,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#3157D5',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 6,
    minHeight: 54,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.6 },
  modeButton: {
    alignItems: 'center',
    marginTop: 24,
    padding: 12,
  },
  modeButtonText: {
    color: '#3157D5',
    fontSize: 15,
    fontWeight: '600',
  },
  error: {
    color: '#B42318',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  notice: {
    color: '#247247',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
});
