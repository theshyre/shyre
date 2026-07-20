import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { DOC_TOPICS, getTopicBySlug } from "@/lib/docs/topics";

export async function generateStaticParams(): Promise<{ topic: string }[]> {
  return DOC_TOPICS.map((topic) => ({ topic: topic.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string }>;
}): Promise<Metadata> {
  const { topic: topicSlug } = await params;
  const topic = getTopicBySlug(topicSlug);
  return { title: topic ? `${topic.name} · Docs` : "Docs" };
}

export default async function DocTopicIndexPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}): Promise<React.JSX.Element> {
  const { topic: topicSlug } = await params;
  const topic = getTopicBySlug(topicSlug);
  if (!topic) notFound();

  const t = await getTranslations("docs");
  const [quickGuide, ...rest] = topic.articles;

  return (
    <div className="space-y-6">
      <nav
        aria-label="Breadcrumbs"
        className="flex items-center gap-2 text-caption text-content-muted"
      >
        <Link
          href="/docs"
          className="inline-flex items-center gap-1 hover:text-content"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          {t("topicIndex.backToDocs")}
          <LinkPendingSpinner />
        </Link>
      </nav>

      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft">
          <topic.icon size={20} className="text-accent" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-page-title font-bold text-content">{topic.name}</h1>
          <p className="text-body-lg text-content-secondary">{topic.blurb}</p>
        </div>
      </header>

      <p className="text-caption text-content-muted">
        {t("topicIndex.articleCount", { count: topic.articles.length })}
      </p>

      <div className="space-y-3">
        {quickGuide && (
          <Link
            href={quickGuide.href}
            className="flex items-start gap-3 rounded-lg border-2 border-accent bg-accent-soft/40 p-4 hover:bg-accent-soft transition-colors"
          >
            <Sparkles size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-caption font-medium text-content-inverse">
                  {t("quickGuide.label")}
                </span>
                <span className="text-body-lg font-semibold text-content">{topic.name}</span>
              </div>
              <p className="mt-1 text-caption text-content-muted">{quickGuide.blurb}</p>
            </div>
            <ArrowRight size={16} className="mt-1 shrink-0 text-accent" aria-hidden="true" />
            <LinkPendingSpinner />
          </Link>
        )}

        {rest.length > 0 && (
          <ol className="space-y-2">
            {rest.map((article, i) => (
              <li key={article.href}>
                <Link
                  href={article.href}
                  className="flex items-start gap-3 rounded-lg border border-edge bg-surface-raised p-4 hover:bg-hover transition-colors"
                >
                  <span
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-inset text-caption font-medium text-content-muted"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1">
                    <div className="text-body-lg font-medium text-content">
                      {article.title}
                    </div>
                    <p className="mt-0.5 text-caption text-content-muted">{article.blurb}</p>
                  </div>
                  <LinkPendingSpinner />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
