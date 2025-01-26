import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  getDocs,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { Note } from '../types';

export const notesCollection = collection(db, 'notes');

export const createNote = async (note: Omit<Note, 'id'>): Promise<Note> => {
  const docRef = await addDoc(notesCollection, {
    ...note,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  
  return {
    ...note,
    id: docRef.id,
  } as Note;
};

export const updateNote = async (id: string, note: Partial<Note>): Promise<void> => {
  const docRef = doc(db, 'notes', id);
  await updateDoc(docRef, {
    ...note,
    updatedAt: Timestamp.now(),
  });
};

export const deleteNote = async (id: string): Promise<void> => {
  const docRef = doc(db, 'notes', id);
  await deleteDoc(docRef);
};

export const getNotesByWorkspace = async (workspaceId: string, userId: string): Promise<Note[]> => {
  const q = query(
    notesCollection,
    where('workspaceId', '==', workspaceId),
    where('userId', '==', userId)
  );
  
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((doc) => ({
    ...doc.data(),
    id: doc.id,
  })) as Note[];
};

export const searchNotes = async (
  userId: string,
  searchTerm: string,
  workspaceId?: string
): Promise<Note[]> => {
  let q = query(notesCollection, where('userId', '==', userId));
  
  if (workspaceId) {
    q = query(q, where('workspaceId', '==', workspaceId));
  }
  
  const querySnapshot = await getDocs(q);
  const notes = querySnapshot.docs.map((doc) => ({
    ...doc.data(),
    id: doc.id,
  })) as Note[];
  
  // Recherche locale dans le contenu et le titre
  return notes.filter(
    (note) =>
      note.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      note.content.toLowerCase().includes(searchTerm.toLowerCase())
  );
};
