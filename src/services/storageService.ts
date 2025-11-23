import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  listAll,
  getMetadata,
} from 'firebase/storage';
import { storage } from './firebase';
import { Attachment } from '../types';

export const uploadFile = async (
  file: File,
  userId: string,
  noteId: string
): Promise<Attachment> => {
  try {
    // Create a reference to the file location
    const filePath = `users/${userId}/notes/${noteId}/${file.name}`;
    const fileRef = ref(storage, filePath);

    // Upload the file
    const snapshot = await uploadBytes(fileRef, file);
    const downloadURL = await getDownloadURL(snapshot.ref);

    // Create attachment metadata
    const attachment: Attachment = {
      id: snapshot.ref.fullPath,
      name: file.name,
      url: downloadURL,
      type: file.type,
      size: file.size,
      createdAt: new Date(),
    };

    return attachment;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
};

export const deleteFile = async (userId: string, noteId: string, fileName: string): Promise<void> => {
  try {
    const filePath = `users/${userId}/notes/${noteId}/${fileName}`;
    const fileRef = ref(storage, filePath);
    await deleteObject(fileRef);
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
};

export const getNoteAttachments = async (
  userId: string,
  noteId: string
): Promise<Attachment[]> => {
  try {
    const attachmentsRef = ref(storage, `users/${userId}/notes/${noteId}`);
    const attachmentsList = await listAll(attachmentsRef);
    
    const attachments = await Promise.all(
      attachmentsList.items.map(async (item) => {
        const downloadURL = await getDownloadURL(item);
        const metadata = await getMetadata(item);
        
        return {
          id: item.fullPath,
          name: item.name,
          url: downloadURL,
          type: metadata.contentType || 'application/octet-stream',
          size: metadata.size || 0,
          createdAt: new Date(metadata.timeCreated),
        };
      })
    );

    return attachments;
  } catch (error) {
    console.error('Error getting note attachments:', error);
    throw error;
  }
};

export const getFileURL = async (filePath: string): Promise<string> => {
  try {
    const fileRef = ref(storage, filePath);
    return await getDownloadURL(fileRef);
  } catch (error) {
    console.error('Error getting file URL:', error);
    throw error;
  }
};
