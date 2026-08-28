import { redirect } from 'next/navigation';

// /glossary has no page of its own: the items queue is what a person came for.
export default function GlossaryIndex() {
  redirect('/glossary/items');
}
