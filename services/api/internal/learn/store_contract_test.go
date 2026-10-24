package learn_test

import (
	"testing"

	"github.com/google/uuid"

	"github.com/sruj08/margadarshak/services/api/internal/learn"
	"github.com/sruj08/margadarshak/services/api/internal/learn/learntest"
)

// The reference semantics pass the store contract (internal/store runs it on PostgreSQL).
func TestStoreContract_MemStore(t *testing.T) {
	learntest.RunStoreContract(t, func(*testing.T) learntest.Fixture {
		holder := uuid.New()
		member := uuid.New()
		return learntest.Fixture{
			Store:  learn.NewMemStore(),
			Holder: learn.Subject{Tenant: "JK", ApplicantID: holder, Account: true},
			Member: learn.Subject{Tenant: "JK", ApplicantID: holder, MemberID: &member, Account: true},
			Other:  learn.Subject{Tenant: "JK", ApplicantID: uuid.New()},
		}
	})
}
