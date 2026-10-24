package study_test

import (
	"testing"

	"github.com/google/uuid"

	"github.com/sruj08/margadarshak/services/api/internal/study"
	"github.com/sruj08/margadarshak/services/api/internal/study/studytest"
)

func TestMemStoreContract(t *testing.T) {
	studytest.RunStoreContract(t, func(t *testing.T) studytest.Fixture {
		m := study.NewMemStore()
		return studytest.Fixture{
			Store: m, Tenant: "JK", Other: "KL",
			Applicant: func(*testing.T, string) (uuid.UUID, uuid.UUID) { return uuid.New(), uuid.New() },
			AddSession: func(_ *testing.T, tenant string, _ uuid.UUID, s *study.Session) {
				c := *s
				m.AddSession(tenant, &c)
			},
			SetBlocks: func(_ *testing.T, tenant string, b *study.Blocks) { m.SetBlocks(tenant, b) },
			LatestStats: func(_ *testing.T, tenant string) *study.PublicStats {
				var latest *study.PublicStats
				for _, s := range m.Stats[tenant] {
					if latest == nil || s.AsOf.After(latest.AsOf) {
						latest = s
					}
				}
				return latest
			},
		}
	})
}
